/**
 * Jupiter Perpetuals Service - Direct on-chain
 * Program ID: PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu
 */

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58').default;

const JUPITER_PERPS_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');

// Token mints
const TOKENS = {
  'SOL': new PublicKey('So11111111111111111111111111111111111111112'),
  'BTC': new PublicKey('9n4nbM75f5Ui33ZbPYJz59yiGzG4oeGLAz8L9nnwVBu'),
  'ETH': new PublicKey('2FPyTwcZLUg1MDrwsyoC4nD3S8XLLC9kVuKnpM5Kf6w'),
  'USDC': new PublicKey('EPjFWdd5AufqSSqeM2qNStxVNLX5kM4jE5cG4HkJQN'),
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
    this.initialized = true;
    console.log('✅ Jupiter Perps service initialized (direct on-chain)');
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

  // Build open position instruction
  buildOpenPositionInstruction(walletAddress, marketIndex, size, direction) {
    const userAccount = this.getUserAccountAddress(walletAddress);
    
    // Instruction data: 
    // byte 0: instruction type (let's try different ones)
    // The actual format is complex - this is a guess
    
    // Try instruction 2 (OpenPosition based on common patterns)
    const instructionData = Buffer.alloc(34);
    instructionData.writeUInt8(2, 0); // Open position instruction
    
    // Market index (4 bytes)
    instructionData.writeUInt32LE(marketIndex, 1);
    
    // Size (8 bytes) - as raw units
    instructionData.writeBigUInt64LE(BigInt(size), 5);
    
    // Direction: 0 = long, 1 = short (4 bytes)
    instructionData.writeUInt32LE(direction === 'long' ? 0 : 1, 13);
    
    // Slippage (8 bytes) - allow 1% slippage
    instructionData.writeBigUInt64LE(BigInt(10000), 17);
    
    // Padding to reach expected size
    // (remaining bytes are zeros)

    const keys = [
      { pubkey: new PublicKey(walletAddress), isSigner: true, isWritable: true },
      { pubkey: userAccount, isSigner: false, isWritable: true },
      // More accounts would be needed here
    ];

    return new TransactionInstruction({
      programId: JUPITER_PERPS_PROGRAM_ID,
      keys,
      data: instructionData,
    });
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) {
      return { success: false, error: 'Wallet not initialized' };
    }

    const marketIndex = { 'SOL': 0, 'BTC': 1, 'ETH': 2 }[symbol.toUpperCase()];
    if (marketIndex === undefined) {
      return { success: false, error: `Unknown market: ${symbol}` };
    }

    try {
      // Create transaction
      const transaction = new Transaction();
      
      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.keypair.publicKey;

      // Add instruction
      const instruction = this.buildOpenPositionInstruction(
        this.walletAddress,
        marketIndex,
        Math.floor(amount * leverage * 1000), // size in smallest units
        side.toLowerCase()
      );
      transaction.add(instruction);

      // Try to simulate first
      try {
        const simulation = await this.connection.simulateTransaction(transaction);
        console.log('Simulation result:', simulation.value);
        
        if (simulation.value.err) {
          return {
            success: false,
            error: `Simulation failed: ${JSON.stringify(simulation.value.err)}`
          };
        }
      } catch (simError) {
        console.log('Simulation error:', simError.message);
      }

      // For now, return unsigned transaction for user to sign
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });
      
      return {
        success: false,
        error: `Transaction built but requires signing.

To trade with this wallet:
1. This bot cannot sign transactions yet
2. Use your wallet's app (Phantom, Backpack) to sign

This feature requires:
- Wallet adapter integration
- Or use app.drift.trade directly`,
        transaction: serialized.toString('base64'),
        note: 'Set up wallet adapter to enable auto-signing'
      };

    } catch (error) {
      console.error('Open position error:', error);
      return { success: false, error: error.message };
    }
  }

  async getPositions() {
    if (!this.walletAddress) return [];
    
    try {
      const userAccount = this.getUserAccountAddress(this.walletAddress);
      const accountInfo = await this.connection.getParsedAccountInfo(userAccount);
      
      if (!accountInfo.value) {
        return [];
      }
      
      return [{
        address: userAccount.toString(),
        data: 'Account exists - parsing needed'
      }];
    } catch (error) {
      return [];
    }
  }

  async getAccountInfo() {
    if (!this.walletAddress) return null;
    
    return {
      wallet: this.walletAddress,
      userAccount: this.getUserAccountAddress(this.walletAddress).toString(),
      program: JUPITER_PERPS_PROGRAM_ID.toString()
    };
  }

  async closePosition(positionIndex) {
    return { success: false, error: 'Not implemented - use UI' };
  }
}

module.exports = { JupiterPerpsService };
