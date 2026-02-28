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
    
    // Multiple RPCs for reliability
    this.rpcUrls = [
      'https://api.mainnet-beta.solana.com',
      'https://rpc.ankr.com/solana',
      'https://solana-rpc.publicnode.com'
    ];
    
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps v11 (verified addresses)');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  getUSDC_ATA(owner) {
    const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const ataProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
      ataProgram
    )[0];
  }

  async tryCheckAccount(pubkey) {
    for (const rpcUrl of this.rpcUrls) {
      try {
        const conn = new Connection(rpcUrl, 'confirmed');
        const info = await conn.getParsedAccountInfo(pubkey);
        if (info.value) return info;
      } catch (e) {
        // Try next RPC
      }
    }
    return null;
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { error: 'No wallet' };

    const market = symbol.toUpperCase();
    if (!CUSTODIES[market]) return { error: `Unknown: ${symbol}` };

    try {
      const wallet = this.keypair.publicKey;
      const usdcATA = this.getUSDC_ATA(wallet);
      console.log('Using USDC ATA:', usdcATA.toString());
      
      // Check if USDC ATA exists, if not create it
      const ataInfo = await this.connection.getParsedAccountInfo(usdcATA);
      if (!ataInfo.value) {
        console.log('Creating USDC ATA...');
        const { createInitializeAssociatedTokenAccountInstruction } = require('@solana/spl-token');
        const createATAInstr = createInitializeAssociatedTokenAccountInstruction(
          wallet,
          usdcATA,
          wallet,
          MINTS.USDC
        );
        
        // Create a simple transfer to initialize ATA
        const { createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
        // Use system program or create minimal transfer
        
        // Actually, need to use a different approach - create ATA via sendTransaction
        // The simplest is to send 0 USDC to the ATA address
        return {
          error: `USDC account not initialized.\n\nPlease send a tiny amount of USDC (0.01) to:\n\`${usdcATA.toString()}\`\n\nThis will create your USDC token account automatically.`
        };
      }
      
      const sizeUSD = new BN(Math.floor(amount * leverage * 1000000));
      const collateralDelta = new BN(Math.floor(amount * 1000000));
      const priceSlippage = new BN(Math.floor(amount * leverage * 1000000 * 2));
      
      const collateralMint = side.toLowerCase() === 'long' ? MINTS.SOL : MINTS.USDC;

      console.log('Building Jupiter tx:', market, side, sizeUSD.toString());
      
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
      const sig = await this.connection.sendTransaction(tx);
      
      return { 
        success: true, 
        txid: sig,
        message: `🪐 *Position Opened!*\n\n${market}: ${side.toUpperCase()} ${leverage}x\nAmount: $${amount}\n\nTx: \`${sig}\``
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
