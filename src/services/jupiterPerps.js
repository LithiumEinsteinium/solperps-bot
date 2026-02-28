/**
 * Jupiter Perpetuals Service - Using verified encoder
 */

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction } = require('@solana/web3.js');
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
      
      // Check if USDC ATA exists
      const ataInfo = await this.connection.getParsedAccountInfo(usdcATA);
      console.log('ATA check:', ataInfo.value ? 'EXISTS' : 'NOT FOUND');
      
      // Also try direct RPC call
      if (!ataInfo.value) {
        console.log('Trying alternative RPC...');
        const altConn = new Connection('https://rpc.ankr.com/solana', 'confirmed');
        const altInfo = await altConn.getParsedAccountInfo(usdcATA);
        console.log('Alt RPC ATA check:', altInfo.value ? 'EXISTS' : 'NOT FOUND');
        
        if (!altInfo.value) {
          return {
            error: `USDC account not initialized.\n\nYour USDC ATA: \`${usdcATA.toString()}\`\n\nSend 0.01 USDC to create it.`
          };
        }
      }
      
      const sizeUSD = new BN(Math.floor(amount * leverage * 1000000));
      const collateralDelta = new BN(Math.floor(amount * 1000000));
      const priceSlippage = new BN(Math.floor(amount * leverage * 1000000 * 2));
      
      // Use USDC as collateral for both long and short
      const collateralMint = MINTS.USDC;

      console.log('Building Jupiter tx:', market, side, sizeUSD.toString());
      
      const { instructions, blockhash } = await buildOpenPositionTransaction(this.connection, wallet, {
        market,
        side,
        collateralMint,
        collateralDelta,
        sizeUsdDelta: sizeUSD,
        priceSlippage,
        jupiterMinimumOut: null,
      });
      console.log('DEBUG: got instructions, blockhash:', blockhash?.slice(0,20));

      // Create versioned transaction
      console.log('DEBUG: wallet type:', typeof wallet);
      console.log('DEBUG: instructions type:', typeof instructions);
      console.log('DEBUG: instructions[0] keys:', instructions[0]?.keys?.map(k => k.pubkey?.toBase58()));
      console.log('DEBUG: instructions[1] keys:', instructions[1]?.keys?.map(k => k.pubkey?.toBase58()));
      console.log('DEBUG: instructions[2] keys:', instructions[2]?.keys?.map(k => k.pubkey?.toBase58()));
      
      console.log('DEBUG: Creating Transaction...');
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;
      instructions.forEach(instr => tx.add(instr));
      
      console.log('DEBUG: Signing tx...');
      tx.sign(this.keypair);
      
      console.log('DEBUG: Serializing tx...');
      const serialized = tx.serialize();
      console.log('DEBUG: Sending tx...');
      const sig = await this.connection.sendRawTransaction(serialized);
      
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
