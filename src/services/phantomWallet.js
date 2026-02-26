/**
 * Phantom Wallet Integration for SolPerps Bot
 * 
 * Users connect their own Phantom wallet instead of the bot holding keys.
 * The bot executes trades by having users sign transactions.
 */

const PHANTOM_DEEP_LINK = 'https://phantom.app/ul/v1/connect';
const PHANTOM_APP_ID = process.env.PHANTOM_APP_ID || '';

class PhantomWalletManager {
  constructor() {
    this.connected = false;
    this.publicKey = null;
    this.balance = 0;
  }

  /**
   * Generate Phantom wallet connect URL
   */
  getConnectUrl() {
    const params = new URLSearchParams({
      app_url: process.env.APP_URL || 'https://solperps-bot.onrender.com',
      dapp_encryption_public_key: '', // Generated on backend for security
      redirect_uri: `${process.env.APP_URL || 'https://solperps-bot.onrender.com'}/callback`,
    });
    
    if (PHANTOM_APP_ID) {
      params.append('app_id', PHANTOM_APP_ID);
    }
    
    return `https://phantom.app/ul/v1/connect?${params.toString()}`;
  }

  /**
   * Handle callback from Phantom
   */
  async handleCallback(data) {
    try {
      // Validate and process the connection data
      if (data.public_key) {
        this.publicKey = data.public_key;
        this.connected = true;
        await this.fetchBalance();
        return { success: true, publicKey: this.publicKey };
      }
      return { success: false, error: 'No public key in response' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch wallet balance from Solana
   */
  async fetchBalance(rpcUrl = 'https://api.mainnet-beta.solana.com') {
    if (!this.publicKey) return 0;
    
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [this.publicKey]
        })
      });
      
      const data = await response.json();
      this.balance = data.result?.value / 1e9 || 0; // Convert lamports to SOL
      return this.balance;
    } catch (error) {
      console.error('Balance fetch error:', error);
      return 0;
    }
  }

  /**
   * Disconnect wallet
   */
  disconnect() {
    this.connected = false;
    this.publicKey = null;
    this.balance = 0;
  }

  /**
   * Get wallet status
   */
  getStatus() {
    return {
      connected: this.connected,
      publicKey: this.publicKey,
      balance: this.balance
    };
  }
}

module.exports = { PhantomWalletManager };
