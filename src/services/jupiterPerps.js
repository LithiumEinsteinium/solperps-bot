/**
 * Jupiter Perpetuals Service - Simplified
 */

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;

class JupiterPerpsService {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps ready');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { error: 'No wallet' };
    
    return { 
      error: `🪐 Jupiter Perps

Your wallet: \`${this.walletAddress}\`

To trade:
1. Send USDC to this wallet
2. Use Phantom/Backpack to connect to app.drift.trade
3. Trade with this same wallet`,
      wallet: this.walletAddress
    };
  }

  async getPositions() { return []; }
  async getAccountInfo() { return { wallet: this.walletAddress }; }
  async closePosition() { return { error: 'Use UI' }; }
}

module.exports = { JupiterPerpsService };
