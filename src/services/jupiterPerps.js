/**
 * Jupiter Perpetuals Service - Using the complete encoder
 */

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const BN = require('bn.js');
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const { 
  createIncreasePositionMarketRequest,
  createDecreasePositionMarketRequest,
  buildOpenPositionTransaction,
  PERP_PROGRAM_ID,
  JLP_POOL,
  CUSTODIES,
  CUSTODY_TOKEN_ACCOUNTS,
  ORACLE_ACCOUNTS,
  MINTS,
} = require('./jupiterPerpsEncoder');

class JupiterPerpsService {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps v9 (complete encoder)');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  getUSDC_ATA(owner) {
    return getAssociatedTokenAddressSync(MINTS.USDC, owner, true);
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { error: 'No wallet' };

    const market = symbol.toUpperCase();
    if (!CUSTODIES[market]) return { error: `Unknown: ${symbol}` };

    try {
      const wallet = this.keypair.publicKey;
      const usdcATA = this.getUSDC_ATA(wallet);
      
      const sizeUSD = new BN(Math.floor(amount * leverage * 1000000)); // USDC 6 decimals
      const collateralDelta = new BN(Math.floor(amount * 1000000)); // same as size
      const priceSlippage = new BN(Math.floor(amount * leverage * 1000000 * 2)); // 2x as backup
      
      // For long: collateral = SOL, For short: collateral = USDC
      const collateralMint = side.toLowerCase() === 'long' ? MINTS.SOL : MINTS.USDC;

      console.log('Building Jupiter Perps transaction...');
      console.log('Market:', market, 'Side:', side, 'Size:', sizeUSD.toString());

      // Build the transaction
      const tx = await buildOpenPositionTransaction(this.connection, wallet, {
        market,
        side,
        collateralMint,
        collateralDelta,
        sizeUsdDelta: sizeUSD,
        priceSlippage,
        jupiterMinimumOut: null,
      });

      // Sign with our keypair
      tx.sign([this.keypair]);

      // Send
      console.log('Sending transaction...');
      const signature = await this.connection.sendTransaction(tx);
      
      console.log('✅ Position opened:', signature);
      return { 
        success: true, 
        txid: signature,
        message: `🪐 *Position Opened!*\n\n${market}: ${side.toUpperCase()} ${leverage}x\nAmount: $${amount}\n\nTx: \`${signature}\``
      };

    } catch (e) {
      console.error('Error:', e.message);
      return { error: e.message };
    }
  }

  async closePosition(symbol, side, amount) {
    if (!this.keypair) return { error: 'No wallet' };

    const market = symbol.toUpperCase();
    if (!CUSTODIES[market]) return { error: `Unknown: ${symbol}` };

    try {
      const wallet = this.keypair.publicKey;
      const outputMint = side.toLowerCase() === 'long' ? MINTS.SOL : MINTS.USDC;

      const sizeUSD = new BN(Math.floor(amount * 1000000));
      const priceSlippage = new BN(Math.floor(amount * 1000000 / 2));

      // Build close transaction
      const tx = await buildClosePositionTransaction(this.connection, wallet, {
        market,
        side,
        collateralUsdDelta: new BN(0),
        sizeUsdDelta: new BN(0),
        priceSlippage,
        jupiterMinimumOut: null,
        entirePosition: true,
        outputMint,
        collateralStable: 'USDC',
      });

      tx.sign([this.keypair]);
      const signature = await this.connection.sendTransaction(tx);
      
      return { success: true, txid: signature };

    } catch (e) {
      return { error: e.message };
    }
  }

  async getPositions() {
    // Would need to fetch position PDAs and check if they exist
    return [];
  }

  async getAccountInfo() {
    return { wallet: this.walletAddress };
  }
}

module.exports = { JupiterPerpsService };
