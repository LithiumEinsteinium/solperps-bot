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
  constructor(config = {}) {
    this.connection = new Connection('https://mainnet.helius-rpc.com/?api-key=d3bae4a8-b9a7-4ce2-9069-6224be9cd33c', 'confirmed');
    this.jupiterApiKey = config.jupiterApiKey || process.env.JUPITER_API_KEY;
    this.jupiterBaseUrl = 'https://api.jup.ag';
    
    // Multiple RPCs for reliability
    this.rpcUrls = [
      'https://mainnet.helius-rpc.com/?api-key=d3bae4a8-b9a7-4ce2-9069-6224be9cd33c',
      'https://solana-rpc.publicnode.com',
      'https://api.mainnet-beta.solana.com'
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
        const altConn = new Connection('https://solana-rpc.publicnode.com', 'confirmed');
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

  async getPositions() {
    console.log('🔍 getPositions called, wallet:', this.walletAddress, 'API key:', this.jupiterApiKey ? 'SET' : 'MISSING');
    
    // Try Jupiter Portfolio API first
    if (this.jupiterApiKey && this.walletAddress) {
      try {
        const url = `${this.jupiterBaseUrl}/portfolio/v1/positions/${this.walletAddress}`;
        console.log('🔍 Fetching:', url);
        
        const response = await fetch(url, {
          headers: { 'x-api-key': this.jupiterApiKey }
        });
        
        console.log('🔍 Response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('🔍 Positions data:', JSON.stringify(data).substring(0, 500));
          return data.positions || [];
        } else {
          const err = await response.text();
          console.log('🔍 API error:', err);
        }
      } catch (e) {
        console.log('🔍 Jupiter Portfolio API error:', e.message);
      }
    } else {
      console.log('🔍 Missing API key or wallet address');
    }
    
    // Fallback: return empty
    return [];
  }
  
  async getAccountInfo() { return { wallet: this.walletAddress }; }
  async closePosition() { return { error: 'Not impl' }; }
}

module.exports = { JupiterPerpsService };
