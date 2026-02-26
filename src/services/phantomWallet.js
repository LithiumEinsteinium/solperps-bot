/**
 * Phantom Wallet Integration for SolPerps Bot
 * 
 * Users connect their own Phantom wallet instead of the bot holding keys.
 * Uses Phantom's deeplink for mobile/extension connection.
 */

class PhantomWalletManager {
  constructor(config = {}) {
    this.connected = false;
    this.publicKey = null;
    this.address = null;
    this.balance = 0;
    this.appId = config.appId || '';
    this.appUrl = config.appUrl || 'https://solperps-bot.onrender.com';
  }

  /**
   * Generate Phantom wallet connect URL with proper parameters
   */
  getConnectUrl() {
    // Generate a unique session ID for this connection
    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Store session for callback verification
    this.pendingSession = sessionId;
    
    // Build the deeplink URL
    const params = new URLSearchParams({
      app_url: this.appUrl,
      redirect_uri: `${this.appUrl}/phantom-callback`,
    });
    
    if (this.appId) {
      params.append('app_id', this.appId);
    }
    
    return `https://phantom.app/ul/v1/connect?${params.toString()}`;
  }

  /**
   * Alternative: Generate a simple wallet address for users to add funds to
   * This is a fallback for users who can't use the deeplink
   */
  getReceiveAddress() {
    // Return the bot's wallet address for receiving funds
    // Users can send SOL/USDC to this address
    return '9ZeG1Tok1PuNspdUexQrR1jqmgZq5Rcq9hcYZcomNMQr'; // Example - bot wallet
  }

  /**
   * Handle callback from Phantom - for future webhook implementation
   */
  async handleCallback(data) {
    try {
      if (data.public_key) {
        this.publicKey = data.public_key;
        this.address = data.public_key;
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
   * Fetch wallet balance from Solana RPC
   */
  async fetchBalance(rpcUrl = 'https://api.mainnet-beta.solana.com') {
    if (!this.address) return 0;
    
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [this.address]
        })
      });
      
      const data = await response.json();
      this.balance = (data.result?.value || 0) / 1e9;
      return this.balance;
    } catch (error) {
      console.error('Balance fetch error:', error);
      return 0;
    }
  }

  /**
   * Manually connect by entering Phantom address
   */
  async connectByAddress(address) {
    // Validate address format (Solana addresses are base58, 32-44 chars)
    if (address && address.length >= 32 && address.length <= 44) {
      this.address = address;
      this.publicKey = address;
      this.connected = true;
      await this.fetchBalance();
      return { success: true, address: this.address };
    }
    return { success: false, error: 'Invalid Solana address' };
  }

  /**
   * Connect with just the address (for manual entry)
   */
  connect(address) {
    if (address && address.length >= 32) {
      this.address = address;
      this.connected = true;
      return { success: true };
    }
    return { success: false, error: 'Invalid address' };
  }

  /**
   * Disconnect wallet
   */
  disconnect() {
    this.connected = false;
    this.publicKey = null;
    this.address = null;
    this.balance = 0;
  }

  /**
   * Get wallet status
   */
  getStatus() {
    return {
      connected: this.connected,
      address: this.address,
      balance: this.balance
    };
  }

  /**
   * Format address for display (first 6 and last 4)
   */
  formatAddress(addr) {
    if (!addr) return 'Not connected';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }
}

module.exports = { PhantomWalletManager };
