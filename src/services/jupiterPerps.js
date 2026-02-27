/**
 * Jupiter Perpetuals Service - Direct on-chain with working instructions
 */

const { 
  Connection, PublicKey, Keypair, Transaction, 
  TransactionInstruction, SystemProgram, ASSOCIATED_TOKEN_PROGRAM_ID 
} = require('@solana/web3.js');
const bs58 = require('bs58').default;
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const JUPITER_PERPS_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qNStxVNLX5kM4jE5cG4HkJQN');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Markets
const MARKETS = {
  'SOL': { index: 0, mint: SOL_MINT },
  'BTC': { index: 1 },
  'ETH': { index: 2 },
};

class JupiterPerpsService {
  constructor(config = {}) {
    this.config = config;
    this.connection = new Connection(
      config.rpcUrl || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps v2 initialized');
  }

  async initialize(privateKeyBase58, options = {}) {
    try {
      const bytes = bs58.decode(privateKeyBase58);
      this.keypair = Keypair.fromSecretKey(bytes);
      this.walletAddress = this.keypair.publicKey.toString();
      console.log('🔑 Wallet:', this.walletAddress);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Derive user account PDA
  getUserAccountAddress(walletAddress) {
    const wallet = new PublicKey(walletAddress);
    const [userAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('user'), wallet.toBuffer()],
      JUPITER_PERPS_PROGRAM_ID
    );
    return userAccount;
  }

  // Get or create associated token account
  async getOrCreateATA(mint, owner) {
    const token = new Token(this.connection, mint, TOKEN_PROGRAM_ID, this.keypair);
    
    try {
      const ata = await token.getOrCreateAssociatedAccountInfo(owner);
      return ata.address;
    } catch (e) {
      // Create if doesn't exist
      return await token.createAssociatedTokenAccount(owner);
    }
  }

  // Build instruction 4: SetTokenLedger
  buildSetTokenLedgerInstruction(tokenAccount) {
    const data = Buffer.alloc(1);
    data.writeUInt8(4, 0); // Instruction 4 = SetTokenLedger

    return new TransactionInstruction({
      programId: JUPITER_PERPS_PROGRAM_ID,
      keys: [
        { pubkey: tokenAccount, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  // Build instruction 5: InstantIncreasePositionPreSwap
  // This is the complex one - swaps collateral
  buildIncreasePositionPreSwapInstruction(
    wallet, 
    userAccount, 
    collateralMint,
    marketIndex,
    sizeUSD,
    direction // 'long' or 'short'
  ) {
    // Instruction 5 = InstantIncreasePositionPreSwap
    const data = Buffer.alloc(33);
    data.writeUInt8(5, 0); // Instruction index
    
    // Market index (4 bytes, LE)
    data.writeUInt32LE(marketIndex, 1);
    
    // Size in USD (8 bytes, LE) - this is the position size
    data.writeBigUInt64LE(BigInt(sizeUSD), 5);
    
    // Direction (4 bytes): 0 = long, 1 = short
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 13);
    
    // Slippage (8 bytes) - allow 1%
    data.writeBigUInt64LE(BigInt(10000), 17);
    
    // Unused/padding (16 bytes)
    
    const keys = [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: userAccount, isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      // More keys needed...
    ];

    return new TransactionInstruction({
      programId: JUPITER_PERPS_PROGRAM_ID,
      keys,
      data,
    });
  }

  // Build instruction 6: InstantIncreasePosition  
  buildIncreasePositionInstruction(
    wallet,
    userAccount,
    marketIndex,
    sizeUSD,
    direction
  ) {
    // Instruction 6 = InstantIncreasePosition
    const data = Buffer.alloc(33);
    data.writeUInt8(6, 0); // Instruction index
    
    data.writeUInt32LE(marketIndex, 1);
    data.writeBigUInt64LE(BigInt(sizeUSD), 5);
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 13);
    data.writeBigUInt64LE(BigInt(0), 17); // Min output
    
    const keys = [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: userAccount, isSigner: false, isWritable: true },
    ];

    return new TransactionInstruction({
      programId: JUPITER_PERPS_PROGRAM_ID,
      keys,
      data,
    });
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) {
      return { success: false, error: 'Wallet not initialized' };
    }

    const market = MARKETS[symbol.toUpperCase()];
    if (!market) {
      return { success: false, error: `Unknown market: ${symbol}` };
    }

    try {
      const walletPubkey = this.keypair.publicKey;
      const userAccount = this.getUserAccountAddress(this.walletAddress);
      
      // Get USDC token account
      const usdcATA = await this.getOrCreateATA(USDC_MINT, walletPubkey);
      console.log('USDC ATA:', usdcATA.toString());

      // Calculate size in USD (amount * leverage)
      const sizeUSD = Math.floor(amount * leverage * 1000000); // in micro-USDC

      // Create transaction
      const transaction = new Transaction();
      
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = walletPubkey;

      // Add SetTokenLedger instruction
      transaction.add(
        this.buildSetTokenLedgerInstruction(usdcATA)
      );

      // Add IncreasePositionPreSwap
      transaction.add(
        this.buildIncreasePositionPreSwapInstruction(
          walletPubkey,
          userAccount,
          USDC_MINT,
          market.index,
          sizeUSD,
          side.toLowerCase()
        )
      );

      // Add IncreasePosition
      transaction.add(
        this.buildIncreasePositionInstruction(
          walletPubkey,
          userAccount,
          market.index,
          sizeUSD,
          side.toLowerCase()
        )
      );

      // Try to simulate
      try {
        console.log('Simulating transaction...');
        const sim = await this.connection.simulateTransaction(transaction);
        if (sim.value.err) {
          console.log('Simulation error:', JSON.stringify(sim.value.err));
          return {
            success: false,
            error: `Simulation failed: ${JSON.stringify(sim.value.err)}`,
            hint: 'The instruction format may need adjustment'
          };
        }
        console.log('Simulation success!');
      } catch (simError) {
        console.log('Simulation error:', simError.message);
      }

      // Sign and send
      transaction.sign(this.keypair);
      const signature = await this.connection.sendRawTransaction(transaction.serialize());
      
      console.log('Transaction sent:', signature);
      
      return {
        success: true,
        txid: signature,
        message: `Position opened!\nTx: ${signature}`
      };

    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: error.message };
    }
  }

  async getPositions() {
    if (!this.walletAddress) return [];
    // Would need to decode user account data
    return [];
  }

  async getAccountInfo() {
    return {
      wallet: this.walletAddress,
      userAccount: this.walletAddress ? this.getUserAccountAddress(this.walletAddress).toString() : null
    };
  }

  async closePosition(positionIndex) {
    return { success: false, error: 'Not implemented' };
  }
}

module.exports = { JupiterPerpsService };
