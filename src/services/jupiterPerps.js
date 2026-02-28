/**
 * Jupiter Perpetuals Service
 * Uses createIncreasePositionMarketRequest / createDecreasePositionMarketRequest
 * (keeper-executed request flow — the correct way to interact with Jupiter Perps).
 */

const { Connection, PublicKey, Keypair, Transaction, ComputeBudgetProgram } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const BN = require('bn.js');

const {
  CUSTODIES,
  MINTS,
  buildOpenPositionTransaction,
  buildClosePositionTransaction,
} = require('./jupiterPerpsEncoder');

class JupiterPerpsService {
  constructor(config = {}) {
    // Primary RPC: use env var, or fall back to Helius key from env, or hardcoded default
    const rpcUrl = config.rpcUrl
      || process.env.RPC_URL
      || `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || 'd3bae4a8-b9a7-4ce2-9069-6224be9cd33c'}`;

    this.connection = new Connection(rpcUrl, 'confirmed');

    // Fallback RPCs — Ankr requires a paid key so removed; replaced with mainnet-beta
    this.rpcUrls = [
      rpcUrl,
      'https://solana-rpc.publicnode.com',
      'https://api.mainnet-beta.solana.com',
    ];

    this.keypair = null;
    this.walletAddress = null;

    // Monotonically-incrementing counter used to make each PositionRequest PDA unique.
    // In production you should read the on-chain position account's requestCounter field
    // to pick up where you left off after a restart.
    this._counter = 0;

    console.log('✅ Jupiter Perps service initialized');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  /** Retry across fallback RPCs */
  async withConnection(fn) {
    for (const rpcUrl of this.rpcUrls) {
      try {
        const conn = new Connection(rpcUrl, 'confirmed');
        return await fn(conn);
      } catch (e) {
        console.warn(`RPC ${rpcUrl} failed:`, e.message);
      }
    }
    throw new Error('All RPC endpoints failed');
  }

  /**
   * Submit an increase-position request.
   * @param {string} symbol   'SOL' | 'ETH' | 'BTC'
   * @param {string} side     'long' | 'short'
   * @param {number} amount   Collateral in USDC (e.g. 10 = $10)
   * @param {number} leverage Leverage multiplier (e.g. 10)
   */
  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { success: false, error: 'No wallet initialised' };

    const market = symbol.toUpperCase();
    if (!CUSTODIES[market]) return { success: false, error: `Unknown market: ${symbol}` };

    try {
      const wallet  = this.keypair.publicKey;
      const counter = this._counter++;

      // collateralTokenDelta: USDC token lamports (6 decimals)
      const collateralTokenDelta = new BN(Math.floor(amount * 1_000_000));
      // sizeUsdDelta: collateral × leverage in USD (6 decimals)
      const sizeUsdDelta = new BN(Math.floor(amount * leverage * 1_000_000));
      // priceSlippage: 2% of size
      const priceSlippage = new BN(Math.floor(amount * leverage * 1_000_000 * 0.02));

      console.log(`Building Jupiter tx: ${market} ${side} size=${sizeUsdDelta} collateral=${collateralTokenDelta} counter=${counter}`);

      const { instructions, blockhash } = await this.withConnection(conn =>
        buildOpenPositionTransaction(conn, wallet, {
          market,
          side,
          collateralMint: MINTS.USDC,
          collateralTokenDelta,
          sizeUsdDelta,
          priceSlippage,
          counter,
        })
      );

      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;
      // Compute budget prevents "exceeded compute units" errors
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }));
      instructions.forEach(ix => tx.add(ix));
      tx.sign(this.keypair);

      const sig = await this.withConnection(conn =>
        conn.sendRawTransaction(tx.serialize(), { skipPreflight: false })
      );

      return {
        success: true,
        txid: sig,
        message: `🪐 *Position Request Submitted!*\n\n${market}: ${side.toUpperCase()} ${leverage}x\nCollateral: $${amount} USDC\n\nJupiter's keeper will execute the trade shortly.\n\nTx: \`${sig}\``,
      };
    } catch (e) {
      console.error('openPosition error:', e.message);
      return { success: false, error: e.message };
    }
  }

  async closePosition(symbol, side, opts = {}) {
    if (!this.keypair) return { success: false, error: 'No wallet initialised' };

    const market = symbol.toUpperCase();
    if (!CUSTODIES[market]) return { success: false, error: `Unknown market: ${symbol}` };

    try {
      const wallet  = this.keypair.publicKey;
      const counter = opts.counter !== undefined ? opts.counter : this._counter++;

      const { instructions, blockhash } = await this.withConnection(conn =>
        buildClosePositionTransaction(conn, wallet, {
          market,
          side,
          collateralUsdDelta: new BN(0),
          sizeUsdDelta: new BN(0),
          priceSlippage: opts.priceSlippage || new BN(1_000_000),
          entirePosition: true,
          counter,
        })
      );

      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }));
      instructions.forEach(ix => tx.add(ix));
      tx.sign(this.keypair);

      const sig = await this.withConnection(conn =>
        conn.sendRawTransaction(tx.serialize(), { skipPreflight: false })
      );

      return {
        success: true,
        txid: sig,
        message: `✅ *Position Close Requested*\n\n${market}: ${side.toUpperCase()}\n\nTx: \`${sig}\``,
      };
    } catch (e) {
      console.error('closePosition error:', e.message);
      return { success: false, error: e.message };
    }
  }

  async getPositions() { return []; }
  async getAccountInfo() { return { wallet: this.walletAddress }; }
}

module.exports = { JupiterPerpsService };
