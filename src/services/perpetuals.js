/**
 * Perpetuals Trading Service
 * Supports Drift or Jupiter Perps when available
 */

let DriftClient, Wallet, BN, MarketType, PositionDirection;

try {
  const drift = require('@drift-labs/sdk');
  DriftClient = drift.DriftClient;
  Wallet = drift.Wallet;
  BN = drift.BN;
  MarketType = drift.MarketType;
  PositionDirection = drift.PositionDirection;
  console.log('✅ Drift SDK loaded');
} catch (error) {
  console.log('⚠️ Drift SDK load error:', error.message);
  DriftClient = null;
}

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;

const MARKETS = {
  'SOL': { marketIndex: 0, symbol: 'SOL-PERP' },
  'BTC': { marketIndex: 1, symbol: 'BTC-PERP' },
  'ETH': { marketIndex: 2, symbol: 'ETH-PERP' },
};

class PerpetualsService {
  constructor(config = {}) {
    this.config = config;
    this.connection = new Connection(
      config.rpcUrl || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    this.rpcEndpoints = process.env.SOLANA_RPC 
      ? [process.env.SOLANA_RPC]
      : [
          'https://api.mainnet-beta.solana.com',
          'https://rpc.ankr.com/solana',
          'https://solana-rpc.publicnode.com'
        ];
    
    this.driftClient = null;
    this.signer = null;
    this.initialized = false;
  }

  async initialize(privateKeyBase58, options = {}) {
    if (!DriftClient) {
      return { success: false, error: 'Drift SDK not available' };
    }
    
    try {
      const bytes = bs58.decode(privateKeyBase58);
      const keypair = Keypair.fromSecretKey(bytes);
      this.signer = new Wallet(keypair);
      
      console.log('🔑 Wallet derived from private key:');
      console.log('   Public key:', keypair.publicKey.toString());
      console.log('   (Should match your Drift wallet)');
      console.log('📋 Expected wallet:', this.walletAddress);
      
      // Try each RPC
      for (const rpcUrl of this.rpcEndpoints) {
        try {
          console.log(`📡 Trying RPC: ${rpcUrl}`);
          this.connection = new Connection(rpcUrl, 'confirmed');
          
          const sdkConfig = {
            connection: this.connection,
            wallet: this.signer,
            network: 'mainnet',
          };
          
          this.driftClient = new DriftClient(sdkConfig);
          
          if (typeof this.driftClient.initialize === 'function') {
            await this.driftClient.initialize({});
          }
          
          // Try to subscribe
          try {
            if (typeof this.driftClient.subscribe === 'function') {
              await this.driftClient.subscribe();
            }
          } catch (e) {
            console.log('Subscribe warning:', e.message);
          }
          
          this.initialized = true;
          console.log('✅ Drift perpetuals initialized');
          return { success: true };
        } catch (rpcError) {
          console.log(`RPC ${rpcUrl} failed:`, rpcError.message);
          if (rpcError.message.includes('429')) continue;
          throw rpcError;
        }
      }
      
      throw new Error('All RPCs failed');
    } catch (error) {
      console.error('Drift init error:', error.message);
      return { success: false, error: error.message };
    }
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.initialized) {
      return { success: false, error: 'Not initialized' };
    }
    
    try {
      const marketInfo = MARKETS[symbol.toUpperCase()];
      if (!marketInfo) {
        return { success: false, error: `Unknown market: ${symbol}` };
      }
      
      const direction = side.toLowerCase() === 'long' 
        ? PositionDirection.LONG 
        : PositionDirection.SHORT;
      
      // Calculate position size
      const size = new BN(amount * leverage * 1000); // Convert to smallest units
      
      const tx = await this.driftClient.openPosition({
        marketIndex: marketInfo.marketIndex,
        direction,
        size,
        reduceOnly: false,
      });
      
      return { success: true, txid: tx };
    } catch (error) {
      console.error('Open position error:', error.message);
      return { success: false, error: error.message };
    }
  }

  async closePosition(positionIndex) {
    return { success: false, error: 'Not implemented' };
  }

  async getPositions() {
    if (!this.initialized) return [];
    
    try {
      const user = this.driftClient.getUser();
      const positions = user.perpPositions || [];
      return positions.filter(p => p.baseAssetAmount.abs().gt(new BN(0)));
    } catch (error) {
      return [];
    }
  }

  async getAccountInfo() {
    if (!this.initialized) return null;
    
    try {
      const user = this.driftClient.getUser();
      return {
        collateral: user.getTotalCollateral().toNumber() / 1000000,
        health: 100, // Simplified
      };
    } catch (error) {
      return null;
    }
  }
}

module.exports = { PerpetualsService };
