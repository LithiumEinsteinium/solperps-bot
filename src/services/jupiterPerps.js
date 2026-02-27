/**
 * Jupiter Perpetuals Service
 * Direct on-chain interaction via RPC
 * 
 * Program ID: PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu
 */

const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58').default;

const JUPITER_PERPS_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');

// Pool addresses for each market
const POOLS = {
  'SOL': new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq'),
  'BTC': new PublicKey('GqM6iB5JvBqMqKjKoZ3ysEqjV97EVdA1f23FjmZ8H4B'),
  'ETH': new PublicKey('EMcxVDqDM3KCC3VrfAeYzfBNN1W22D2fF3fN7VKMZXX'),
};

class JupiterPerpsService {
  constructor(config = {}) {
    this.config = config;
    this.connection = new Connection(
      config.rpcUrl || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    this.initialized = true;
    console.log('✅ Jupiter Perps service initialized');
  }

  async initialize(privateKeyBase58, options = {}) {
    // Derive wallet from private key
    try {
      const bytes = bs58.decode(privateKeyBase58);
      this.keypair = Keypair.fromSecretKey(bytes);
      this.walletAddress = this.keypair.publicKey.toString();
      console.log('🔑 Wallet:', this.walletAddress);
      return { success: true };
    } catch (error) {
      console.error('Init error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Get user's position account PDA
  getUserPositionAddress(walletAddress, marketIndex = 0) {
    // Derive PDA for user position
    const wallet = new PublicKey(walletAddress);
    const [positionPubkey] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('position'),
        wallet.toBuffer(),
        Buffer.from([marketIndex])
      ],
      JUPITER_PERPS_PROGRAM_ID
    );
    return positionPubkey;
  }

  // Fetch user's position for a market
  async getPosition(marketIndex = 0) {
    try {
      const positionAddress = this.getUserPositionAddress(this.walletAddress, marketIndex);
      console.log('📋 Checking position at:', positionAddress.toString());
      
      const accountInfo = await this.connection.getParsedAccountInfo(positionAddress);
      
      if (!accountInfo.value) {
        console.log('No position found');
        return null;
      }
      
      console.log('Position data:', accountInfo.value.data);
      return accountInfo.value.data;
    } catch (error) {
      console.error('Get position error:', error.message);
      return null;
    }
  }

  // Get all positions for user
  async getPositions() {
    const positions = [];
    
    // Check SOL, BTC, ETH markets
    for (const [symbol, poolAddr] of Object.entries(POOLS)) {
      try {
        const positionAddress = this.getUserPositionAddress(this.walletAddress, positions.length);
        const accountInfo = await this.connection.getParsedAccountInfo(positionAddress);
        
        if (accountInfo.value && accountInfo.value.data) {
          positions.push({
            symbol,
            address: positionAddress.toString(),
            data: accountInfo.value.data
          });
        }
      } catch (e) {
        // No position for this market
      }
    }
    
    return positions;
  }

  // Get pool data (prices, etc)
  async getPoolInfo(symbol) {
    const poolAddr = POOLS[symbol.toUpperCase()];
    if (!poolAddr) {
      return null;
    }
    
    try {
      const accountInfo = await this.connection.getParsedAccountInfo(poolAddr);
      return accountInfo.value?.data;
    } catch (error) {
      console.error('Get pool error:', error.message);
      return null;
    }
  }

  // Open position - placeholder (needs transaction building)
  async openPosition(symbol, side, amount, leverage) {
    // Building actual transactions requires IDL and instruction encoding
    // For now, return a message with instructions
    
    const poolAddr = POOLS[symbol.toUpperCase()];
    if (!poolAddr) {
      return { success: false, error: `Unknown market: ${symbol}` };
    }
    
    return {
      success: false,
      error: `Jupiter Perps requires on-chain transaction signing.

To open a ${side} position:
1. Go to app.drift.trade or use their UI
2. Use your wallet: ${this.walletAddress}

Note: Direct API integration coming soon.`
    };
  }

  async closePosition(positionIndex) {
    return { success: false, error: 'Use Jupiter UI to close positions' };
  }

  async getAccountInfo() {
    return {
      wallet: this.walletAddress,
      note: 'Direct on-chain reading available'
    };
  }
}

module.exports = { JupiterPerpsService };
