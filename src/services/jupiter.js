const axios = require('axios');
const { Connection, PublicKey, Transaction, SystemProgram, TokenProgram } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

class JupiterService {
  constructor(bot, config = {}) {
    this.bot = bot;
    this.config = config;
    this.endpoint = config.endpoint || 'https://api.jup.ag';
    this.perpsEndpoint = config.perpsEndpoint || 'https://perps.jup.ag';
    this.quoteCache = new Map();
  }

  async initialize() {
    console.log('🔗 Connecting to Jupiter...');
    
    // Get available markets
    try {
      const response = await axios.get(`${this.endpoint}/v6/markets`);
      this.markets = response.data;
      console.log(`✅ Connected to Jupiter: ${this.markets.length} markets`);
    } catch (error) {
      console.log('⚠️ Using mock Jupiter connection');
      this.markets = this.getMockMarkets();
    }
  }

  getMockMarkets() {
    return [
      { id: 'SOL/USDC', baseSymbol: 'SOL', quoteSymbol: 'USDC', price: 85.78 },
      { id: 'BTC/USDC', baseSymbol: 'BTC', quoteSymbol: 'USDC', price: 68000 },
      { id: 'ETH/USDC', baseSymbol: 'ETH', quoteSymbol: 'USDC', price: 2025 },
    ];
  }

  // ==================== PRICING ====================

  // Token mint addresses
  getMint(symbol) {
    const mints = {
      'SOL': 'So11111111111111111111111111111111111111112',
      'BTC': '9n4nbM75f5Ui33RZbAWoeymjq22k2X1waSmEqiFbo9pS',
      'ETH': '2ST8DPUy4CNTLG8LXSMcXbC5DkUr1DbKqsN1z5yT2R',
      'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    };
    return mints[symbol] || 'So11111111111111111111111111111111111111112';
  }

  // Get CoinGecko ID mapping
  getCoingeckoId(symbol) {
    const ids = {
      'SOL': 'solana',
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'USDC': 'usd-coin',
      'USDT': 'tether',
    };
    return ids[symbol]?.toLowerCase();
  }

  async getPrice(symbol) {
    // Try Jupiter first
    try {
      const mint = this.getMint(symbol);
      const response = await axios.get(`${this.endpoint}/v6/price`, {
        params: {
          ids: mint
        },
        timeout: 3000
      });
      
      if (response.data && response.data[mint]) {
        const price = parseFloat(response.data[mint].price);
        this.quoteCache.set(symbol, price);
        return price;
      }
    } catch (error) {
      // Fall through to CoinGecko
    }
    
    // Try CoinGecko as backup
    try {
      const coingeckoId = this.getCoingeckoId(symbol);
      if (coingeckoId) {
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
          params: {
            ids: coingeckoId,
            vs_currencies: 'usd'
          },
          timeout: 3000
        });
        
        if (response.data && response.data[coingeckoId]) {
          const price = response.data[coingeckoId].usd;
          this.quoteCache.set(symbol, price);
          return price;
        }
      }
    } catch (error) {
      // Fall through to cache
    }
    
    // Use cached price
    if (this.quoteCache.has(symbol)) {
      return this.quoteCache.get(symbol);
    }
    
    // Default fallback prices
    const defaultPrices = {
      'SOL': 85.78,
      'BTC': 68000,
      'ETH': 2025,
      'BONK': 0.000025,
      'WIF': 0.25,
      'POPCAT': 0.35,
      'MEW': 0.008,
      'SOLVE': 0.12,
    };
    
    return defaultPrices[symbol] || 1;
  }

  // ==================== POSITIONS ====================

  async openPosition(position) {
    console.log(`📤 Opening ${position.side} position: ${position.size} ${position.symbol}`);
    
    // For now, this is a placeholder
    // Real implementation would interact with Jupiter Perps smart contract
    // This requires the Jupiter Perps SDK or direct contract calls
    
    const txId = await this.simulateTransaction(position);
    return {
      ...position,
      txId,
      status: 'open'
    };
  }

  async closePosition(position) {
    console.log(`📥 Closing position: ${position.id}`);
    
    const currentPrice = await this.getPrice(position.symbol);
    const txId = await this.simulateTransaction({
      ...position,
      action: 'close'
    });
    
    return {
      ...position,
      closePrice: currentPrice,
      txId,
      status: 'closed'
    };
  }

  async simulateTransaction(position) {
    // Simulate blockchain delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return 'sim_' + Date.now();
  }

  // ==================== PERPS SPECIFIC ====================

  async getOpenPositions(walletAddress) {
    try {
      const response = await axios.get(`${this.perpsEndpoint}/positions/${walletAddress}`);
      return response.data;
    } catch (error) {
      return [];
    }
  }

  async getPendingOrders(walletAddress) {
    try {
      const response = await axios.get(`${this.perpsEndpoint}/orders/${walletAddress}`);
      return response.data;
    } catch (error) {
      return [];
    }
  }

  // ==================== TRANSFERS ====================

  async transfer(toAddress, amount, token = 'SOL') {
    // This would create and send a real transaction
    console.log(`💸 Transferring ${amount} ${token} to ${toAddress}`);
    
    // Placeholder for actual implementation
    return 'tx_' + Date.now();
  }

  // ==================== QUOTE ====================

  async getQuote(inputMint, outputMint, amount, slippage = 1) {
    try {
      const response = await axios.get(`${this.endpoint}/v6/quote`, {
        params: {
          inputMint,
          outputMint,
          amount,
          slippage,
          restrictIntermediateTokens: true
        }
      });
      return response.data;
    } catch (error) {
      console.error('Quote error:', error.message);
      return null;
    }
  }

  async swap(quote) {
    try {
      const response = await axios.post(`${this.endpoint}/v6/swap`, {
        quoteResponse: quote,
        userPublicKey: this.bot.wallet.publicKey.toString(),
        wrapAndUnwrapSol: true
      });
      return response.data;
    } catch (error) {
      console.error('Swap error:', error.message);
      return null;
    }
  }
}

module.exports = { JupiterService };
