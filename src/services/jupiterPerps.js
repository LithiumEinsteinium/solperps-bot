/**
 * Jupiter Perpetuals Service
 * Uses createIncreasePositionMarketRequest / createDecreasePositionMarketRequest
 * (user-facing, keeper-executed flow).
 */

const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
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
    const rpcUrl = config.rpcUrl || process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=d3bae4a8-b9a7-4ce2-9069-6224be9cd33c';
    this.connection = new Connection(rpcUrl, 'confirmed');

    this.rpcUrls = [
      rpcUrl,
      'https://rpc.ankr.com/solana',
      'https://solana-rpc.publicnode.com',
    ];

    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps service initialized');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  /** Retry connection across fallback RPCs */
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

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { success: false, error: 'No wallet initialised' };

    const market = symbol.toUpperCase();
    if (!CUSTODIES[market]) return { success: false, error: `Unknown market: ${symbol}` };

    try {
      const wallet = this.keypair.publicKey;

      // amount = USDC collateral (6 decimals)
      const collateralDelta = new BN(Math.floor(amount * 1_000_000));
      // position size = collateral × leverage (expressed in USD, 6 decimals)
      const sizeUsdDelta = new BN(Math.floor(amount * leverage * 1_000_000));
      // slippage: 2% of size
      const priceSlippage = new BN(Math.floor(amount * leverage * 1_000_000 * 0.02));

      console.log(`Building Jupiter tx: ${market} ${side} size=${sizeUsdDelta} collateral=${collateralDelta}`);

      const { instructions, blockhash } = await this.withConnection(conn =>
        buildOpenPositionTransaction(conn, wallet, {
          market,
          side,
          collateralMint: MINTS.USDC,
          collateralDelta,
          sizeUsdDelta,
          priceSlippage,
        })
      );

      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;
      instructions.forEach(ix => tx.add(ix));
      tx.sign(this.keypair);

      const sig = await this.withConnection(conn =>
        conn.sendRawTransaction(tx.serialize(), { skipPreflight: false })
      );

      return {
        success: true,
        txid: sig,
        message: `🪐 *Position Opened!*\n\n${market}: ${side.toUpperCase()} ${leverage}x\nCollateral: $${amount} USDC\n\nTx: \`${sig}\``,
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
      const wallet = this.keypair.publicKey;

      // For a full close we set both deltas to max u64 and let the program handle it,
      // but Jupiter's recommended approach is collateralUsdDelta = 0, entirePosition = true.
      const collateralUsdDelta = new BN(0);
      const sizeUsdDelta       = new BN(0);
      const priceSlippage      = opts.priceSlippage || new BN(1_000_000); // $1 default slippage

      const { instructions, blockhash } = await this.withConnection(conn =>
        buildClosePositionTransaction(conn, wallet, {
          market,
          side,
          collateralUsdDelta,
          sizeUsdDelta,
          priceSlippage,
          entirePosition: true,
          jupiterMinimumOut: null,
          counter: opts.counter || 0,
        })
      );

      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;
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
