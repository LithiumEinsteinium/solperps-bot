/**
 * Drift Perpetuals Trading Service
 * Handles perpetual futures trading via Drift Protocol
 * 
 * Note: Requires Node.js with ESM support or --experimental-specifier-resolution=node
 */

let DriftClient, Wallet, BN, MarketType, PositionDirection, DEFAULT_TIMEOUT, OracleSource;

try {
  const drift = require('@drift-labs/sdk');
  DriftClient = drift.DriftClient;
  Wallet = drift.Wallet;
  BN = drift.BN;
  MarketType = drift.MarketType;
  PositionDirection = drift.PositionDirection;
  OracleSource = drift.OracleSource;
  console.log('✅ Drift SDK loaded');
} catch (error) {
  console.log('⚠️ Drift SDK load error:', error.message);
  DriftClient = null; // Will trigger "not loaded" error
}

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;

const MARKETS = {
  'SOL': { marketIndex: 0, symbol: 'SOL-PERP' },
  'BTC': { marketIndex: 1, symbol: 'BTC-PERP' },
  'ETH': { marketIndex: 2, symbol: 'ETH-PERP' },
  'SOL Perp': { marketIndex: 0, symbol: 'SOL-PERP' },
  'BTC Perp': { marketIndex: 1, symbol: 'BTC-PERP' },
  'ETH Perp': { marketIndex: 2, symbol: 'ETH-PERP' }
};

class PerpetualsService {
  constructor(config = {}) {
    this.config = config;
    this.connection = new Connection(
      config.rpcUrl || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    // List of free RPC endpoints (no API key needed)
    // Override with SOLANA_RPC env var if you have a paid endpoint
    const isTestnet = process.env.DRIFT_TESTNET === 'true' || config.testnet === true;
    
    this.isTestnet = isTestnet;
    this.rpcEndpoints = process.env.SOLANA_RPC 
      ? [process.env.SOLANA_RPC]
      : isTestnet
        ? [
            'https://api.testnet.solana.com',
            'https://testnet.solana.dev',
            'https://testnet-rpc.solana.net'
          ]
        : [
            'https://api.mainnet-beta.solana.com',
            'https://rpc.ankr.com/solana',
            'https://solana-rpc.publicnode.com'
          ];
    
    if (isTestnet) {
      console.log('🔷 Using Drift TESTNET RPCs:', this.rpcEndpoints);
    }
    
    this.driftClient = null;
    this.signer = null;
    this.initialized = false;
  }

  /**
   * Initialize Drift client with user's wallet
   */
  async initialize(privateKeyBase58, options = {}) {
    // Check testnet mode - from options or env
    const isTestnet = options.testnet || process.env.DRIFT_TESTNET === 'true';
    this.isTestnet = isTestnet;
    
    // Update RPC endpoints based on network
    this.rpcEndpoints = process.env.SOLANA_RPC 
      ? [process.env.SOLANA_RPC]
      : isTestnet
        ? [
            'https://api.testnet.solana.com',
            'https://testnet.solana.dev',
            'https://testnet-rpc.solana.net'
          ]
        : [
            'https://api.mainnet-beta.solana.com',
            'https://rpc.ankr.com/solana',
            'https://solana-rpc.publicnode.com'
          ];
    
    if (isTestnet) {
      console.log('🔷 Using Drift TESTNET');
    }
    
    // Try to load the SDK if not already loaded
    if (!DriftClient) {
      try {
        console.log('Attempting to load Drift SDK...');
        const drift = require('@drift-labs/sdk');
        DriftClient = drift.DriftClient;
        Wallet = drift.Wallet;
        BN = drift.BN;
        MarketType = drift.MarketType;
        PositionDirection = drift.PositionDirection;
        console.log('✅ Drift SDK loaded successfully');
      } catch (retryError) {
        console.log('Drift SDK load error:', retryError.message);
        return { success: false, error: `Drift SDK load failed. Check server logs.` };
      }
    }
    
    try {
      const bytes = bs58.decode(privateKeyBase58);
      const keypair = Keypair.fromSecretKey(bytes);
      this.signer = new Wallet(keypair);
      
      // Force use of public RPC - don't use config RPC
      console.log('🔧 Drift init with public RPCs only');
      
      // Try different RPCs if rate limited
      let lastError = null;
      for (const rpcUrl of this.rpcEndpoints) {
        try {
          console.log(`📡 Trying RPC: ${rpcUrl}`);
          this.connection = new Connection(rpcUrl, 'confirmed');
          
          const sdkConfig = {
            connection: this.connection,
            wallet: this.signer,
            network: this.isTestnet ? 'testnet' : 'mainnet',
            // Override any internal RPC the SDK might try to use
            rpcUrl: rpcUrl,
            timeout: 60000,
            defaultOptions: {
              commitment: 'confirmed',
              preflightCommitment: 'confirmed'
            }
          };
          
          this.driftClient = new DriftClient(sdkConfig);
          
          // Try new API first, then fall back to old
          if (typeof this.driftClient.initialize === 'function') {
            await this.driftClient.initialize({});
          }
          
          // Check if user exists, if not try to create one
          try {
            console.log('👤 Checking Drift user account...');
            const user = await this.driftClient.getUser();
            if (!user) {
              console.log('👤 No user found, attempting to create...');
              // Try various methods to create user
              if (typeof this.driftClient.initializeUser === 'function') {
                await this.driftClient.initializeUser();
              } else if (typeof this.driftClient.createUser === 'function') {
                await this.driftClient.createUser();
              } else {
                throw new Error('No user creation method available');
              }
            }
          } catch (userError) {
            console.log('User check error:', userError.message);
            // User doesn't exist - they need to create one on Drift UI
            return { 
              success: false, 
              error: `No Drift account. Please:\n1. Go to https://app.drift.trade\n2. Connect your wallet\n3. Deposit USDC\n4. Then try again` 
            };
          }
          
          if (typeof this.driftClient.subscribe === 'function') {
            await this.driftClient.subscribe();
          } else if (typeof this.driftClient.subscribeToAccounts === 'function') {
            await this.driftClient.subscribeToAccounts();
          }
          
          this.initialized = true;
          console.log('✅ Drift perpetuals initialized');
          return { success: true };
        } catch (rpcError) {
          console.log(`RPC ${rpcUrl} failed:`, rpcError.message);
          lastError = rpcError;
          if (rpcError.message.includes('429') || rpcError.message.includes('Too Many Requests')) {
            continue; // Try next RPC
          }
          throw rpcError;
        }
      }
      
      throw lastError || new Error('All RPCs failed');
    } catch (error) {
      console.error('Drift init error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get market info for a symbol
   */
  getMarket(symbol) {
    const upper = symbol.toUpperCase().replace('-PERP', '').replace(' PERP', '');
    return MARKETS[upper] || null;
  }

  /**
   * Open a perpetual position
   */
  async openPosition(symbol, side, amount, leverage = 1) {
    if (!this.initialized) {
      return { success: false, error: 'Not initialized' };
    }

    try {
      const market = this.getMarket(symbol);
      if (!market) {
        return { success: false, error: `Unknown market: ${symbol}` };
      }

      const direction = side.toLowerCase() === 'long' 
        ? PositionDirection.LONG 
        : PositionDirection.SHORT;

      // Amount in USDC (quote currency)
      const amountBN = new BN(amount * 1000000); // Convert to micro-USDC

      // Calculate base asset amount based on leverage
      const baseAssetAmount = amountBN.mul(new BN(leverage));

      console.log(`📊 Opening ${side} ${leverage}x on ${symbol}: ${amount} USDC`);

      // Open the position
      const tx = await this.driftClient.openPosition({
        marketIndex: market.marketIndex,
        direction,
        baseAssetAmount,
        limitPrice: undefined, // Use oracle price
        oraclePriceOffset: 0,
        auctionDuration: 5,
        auctionStartPrice: undefined,
        auctionEndPrice: undefined
      });

      console.log('✅ Position opened:', tx);
      
      return {
        success: true,
        txid: tx,
        market: market.symbol,
        side,
        amount,
        leverage
      };

    } catch (error) {
      console.error('Open position error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Close a position
   */
  async closePosition(positionIndex) {
    if (!this.initialized) {
      return { success: false, error: 'Not initialized' };
    }

    try {
      const positions = await this.getPositions();
      if (!positions[positionIndex]) {
        return { success: false, error: 'Position not found' };
      }

      const position = positions[positionIndex];
      
      const tx = await this.driftClient.closePosition(position.marketIndex);
      
      return {
        success: true,
        txid: tx,
        positionIndex
      };

    } catch (error) {
      console.error('Close position error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all open positions
   */
  async getPositions() {
    if (!this.initialized) {
      return [];
    }

    try {
      const perpMarkets = this.driftClient.getPerpMarketAccounts();
      const userPositions = this.driftClient.getUser().perpPositions;
      
      const positions = [];
      
      for (const pos of userPositions) {
        if (pos.baseAssetAmount.abs().gt(new BN(0))) {
          const marketInfo = Object.values(MARKETS).find(m => m.marketIndex === pos.marketIndex.toNumber());
          positions.push({
            index: pos.marketIndex.toNumber(),
            market: marketInfo?.symbol || `Market ${pos.marketIndex.toNumber()}`,
            side: pos.baseAssetAmount.gt(new BN(0)) ? 'LONG' : 'SHORT',
            size: Math.abs(pos.baseAssetAmount.toNumber() / 1e6),
            entryPrice: pos.quoteEntryAmount.toNumber() / pos.baseAssetAmount.abs().toNumber(),
            pnl: pos.quoteAssetAmount.toNumber() / 1e6,
            leverage: Math.abs(pos.baseAssetAmount.toNumber() / pos.quoteAssetAmount.abs().toNumber())
          });
        }
      }

      return positions;

    } catch (error) {
      console.error('Get positions error:', error.message);
      return [];
    }
  }

  /**
   * Get account info (collateral, health, etc)
   */
  async getAccountInfo() {
    if (!this.initialized) {
      return null;
    }

    try {
      const user = this.driftClient.getUser();
      const collateral = user.getTotalCollateral();
      const health = user.getHealth(MarketType.PERP);
      
      return {
        collateral: collateral.toNumber() / 1e6,
        health: health.toNumber() / 1e6,
        accountAddress: this.driftClient.provider.wallet.publicKey.toString()
      };

    } catch (error) {
      console.error('Account info error:', error.message);
      return null;
    }
  }

  /**
   * Get current price for a market
   */
  async getPrice(symbol) {
    try {
      const market = this.getMarket(symbol);
      if (!market) return null;

      const perpMarket = this.driftClient.getPerpMarket(market.marketIndex);
      const price = perpMarket?.amm?.price.toNumber() / 1e6;
      
      return price;

    } catch (error) {
      console.error('Price error:', error.message);
      return null;
    }
  }

  /**
   * Get funding rate for a market
   */
  async getFundingRate(symbol) {
    try {
      const market = this.getMarket(symbol);
      if (!market) return null;

      const perpMarket = this.driftClient.getPerpMarket(market.marketIndex);
      const fundingRate = perpMarket?.amm?.FundingRate?.toNumber() / 1e6;
      
      return fundingRate;

    } catch (error) {
      console.error('Funding rate error:', error.message);
      return null;
    }
  }
}

module.exports = { PerpetualsService, MARKETS };
