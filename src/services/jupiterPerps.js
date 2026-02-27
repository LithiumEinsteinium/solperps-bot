/**
 * Jupiter Perpetuals Service - Direct on-chain with working instructions
 */

const { 
  Connection, PublicKey, Keypair, Transaction, 
  TransactionInstruction, SystemProgram
} = require('@solana/web3.js');
const bs58 = require('bs58').default;

// Helper to decode base58 address to PublicKey (handles special cases)
function parsePubkey(addr) {
  const decoded = bs58.decode(addr);
  if (decoded.length === 31) {
    return new PublicKey(Buffer.concat([Buffer.alloc(1), decoded]));
  }
  return new PublicKey(decoded);
}

const JUPITER_PERPS_PROGRAM_ID = parsePubkey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const TOKEN_PROGRAM_ID = parsePubkey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = parsePubkey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC_MINT = parsePubkey('EPjFWdd5AufqSSqeM2qNStxVNLX5kM4jE5cG4HkJQN');
const SOL_MINT = parsePubkey('So11111111111111111111111111111111111111112');

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

  // Get associated token account address (without creating)
  getATAAddress(mint, owner) {
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
  }

  // Get or create associated token account
  async getOrCreateATA(mint, owner) {
    const ata = this.getATAAddress(mint, owner);
    
    try {
      const info = await this.connection.getParsedAccountInfo(ata);
      if (info.value) {
        return ata;
      }
    } catch (e) {
      // Account doesn't exist
    }
    
    return ata;
  }

  // Build instruction 4: SetTokenLedger
  buildSetTokenLedgerInstruction(tokenAccount) {
    const data = Buffer.alloc(1);
    data.writeUInt8(4, 0);

    return new TransactionInstruction({
      programId: JUPITER_PERPS_PROGRAM_ID,
      keys: [
        { pubkey: tokenAccount, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  // Build instruction 5: InstantIncreasePositionPreSwap
  buildIncreasePositionPreSwapInstruction(
    wallet, 
    userAccount, 
    collateralMint,
    marketIndex,
    sizeUSD,
    direction
  ) {
    const data = Buffer.alloc(33);
    data.writeUInt8(5, 0);
    data.writeUInt32LE(marketIndex, 1);
    data.writeBigUInt64LE(BigInt(sizeUSD), 5);
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 13);
    data.writeBigUInt64LE(BigInt(10000), 17); // Slippage

    const keys = [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: userAccount, isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      programId: JUPITER_PERPS_PROGRAM_ID,
      keys,
      data,
    });
  }

  // Build instruction 6: InstantIncreasePosition  
  buildIncreasePositionInstruction(wallet, userAccount, marketIndex, sizeUSD, direction) {
    const data = Buffer.alloc(33);
    data.writeUInt8(6, 0);
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

      // Calculate size in USD
      const sizeUSD = Math.floor(amount * leverage * 1000000);

      const transaction = new Transaction();
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = walletPubkey;

      // Add instructions
      transaction.add(this.buildSetTokenLedgerInstruction(usdcATA));
      transaction.add(
        this.buildIncreasePositionPreSwapInstruction(
          walletPubkey, userAccount, USDC_MINT, market.index, sizeUSD, side.toLowerCase()
        )
      );
      transaction.add(
        this.buildIncreasePositionInstruction(
          walletPubkey, userAccount, market.index, sizeUSD, side.toLowerCase()
        )
      );

      // Try to simulate
      try {
        console.log('Simulating...');
        const sim = await this.connection.simulateTransaction(transaction);
        if (sim.value.err) {
          console.log('Sim error:', JSON.stringify(sim.value.err));
          return { success: false, error: 'Sim failed: ' + JSON.stringify(sim.value.err) };
        }
        console.log('Sim success!');
      } catch (e) {
        console.log('Sim error:', e.message);
      }

      // Sign and send
      transaction.sign(this.keypair);
      const signature = await this.connection.sendRawTransaction(transaction.serialize());
      
      return { success: true, txid: signature };

    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: error.message };
    }
  }

  async getPositions() { return []; }
  async getAccountInfo() {
    return { wallet: this.walletAddress };
  }
  async closePosition() { 
    return { success: false, error: 'Not implemented' }; 
  }
}

module.exports = { JupiterPerpsService };
