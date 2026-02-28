/**
 * Jupiter Perpetuals Service - Using verified encoder
 */

const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const BN = require('bn.js');

const { 
  CUSTODIES, 
  MINTS,
  buildOpenPositionTransaction 
} = require('./jupiterPerpsEncoder');

class JupiterPerpsService {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    // Backup RPCs
    this.rpcUrls = [
      'https://api.mainnet-beta.solana.com',
      'https://rpc.ankr.com/solana',
      'https://solana-rpc.publicnode.com'
    ];
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps v10 (verified addresses)');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  getUSDC_ATA(owner) {
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), Buffer.from([0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]), MINTS.USDC.toBuffer()],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    )[0];
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { error: 'No wallet' };

    const market = symbol.toUpperCase();
    if (!CUSTODIES[market]) return { error: `Unknown: ${symbol}` };

    try {
      const wallet = this.keypair.publicKey;
      const usdcATA = this.getUSDC_ATA(wallet);
      
      // Check if USDC ATA exists
      console.log('Checking USDC ATA:', usdcATA.toString());
      const ataInfo = await this.tryCheckAccount(usdcATA);
      console.log('ATA Info:', ataInfo);
      
      if (!ataInfo || !ataInfo.value) {
        return { 
          error: `No USDC token account found.

Your ATA: \`${usdcATA.toString()}\`

1. Send some USDC to this address
2. Then try again`,
          wallet: this.walletAddress
        };
      }
      
      const sizeUSD = new BN(Math.floor(amount * leverage * 1000000));
      const collateralDelta = new BN(Math.floor(amount * 1000000));
      const priceSlippage = new BN(Math.floor(amount * leverage * 1000000 * 2));
      
      const collateralMint = side.toLowerCase() === 'long' ? MINTS.SOL : MINTS.USDC;

      console.log('Building Jupiter transaction...');
      console.log('Market:', market, 'Side:', side, 'Size:', sizeUSD.toString());

      const tx = await buildOpenPositionTransaction(this.connection, wallet, {
        market,
        side,
        collateralMint,
        collateralDelta,
        sizeUsdDelta: sizeUSD,
        priceSlippage,
        jupiterMinimumOut: null,
      });

      tx.sign([this.keypair]);

      console.log('Sending...');
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

  async getPositions() { return []; }
  async getAccountInfo() { return { wallet: this.walletAddress }; }
  async closePosition() { return { error: 'Not impl' }; }
}

module.exports = { JupiterPerpsService };
