/**
 * Jupiter Perpetuals Service - Using Anchor
 */

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const { BorshInstructionCoder } = require('@coral-xyz/anchor');

const idl = require('./jupiter_idl.json');
const coder = new BorshInstructionCoder(idl);

function parsePubkey(addr) {
  const decoded = bs58.decode(addr);
  if (decoded.length === 31) {
    return new PublicKey(Buffer.concat([Buffer.alloc(1), decoded]));
  }
  return new PublicKey(decoded);
}

const JUPITER_PERPS = parsePubkey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const POOL = parsePubkey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');
const PERPETUALS = parsePubkey('H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj');
const TOKEN_PROGRAM = parsePubkey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = parsePubkey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC = parsePubkey('EPjFWdd5AufqSSqeM2qNStxVNLX5kM4jE5cG4HkJQN');

const CUSTODIES = {
  'SOL': parsePubkey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  'ETH': parsePubkey('AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn'),
  'BTC': parsePubkey('5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm'),
  'USDC': parsePubkey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
};

const ORACLES = {
  'SOL': parsePubkey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'),
};

class JupiterPerpsService {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps v8 (Anchor encoded)');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  getPositionPDA(wallet, custody, collateralCustody, side) {
    const sideByte = Buffer.from([side === 'long' ? 0 : 1]);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('position'), wallet.toBuffer(), custody.toBuffer(), collateralCustody.toBuffer(), sideByte],
      JUPITER_PERPS
    )[0];
  }

  getUSDC_ATA(owner) {
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), USDC.toBuffer()],
      ATA_PROGRAM
    )[0];
  }

  buildIncreasePositionIx(wallet, custody, collateralCustody, collateralTokenAccount, sizeUSD, side) {
    const positionPDA = this.getPositionPDA(wallet, custody, collateralCustody, side);
    
    // Use Anchor to encode
    const params = {
      sizeUsdDelta: BigInt(sizeUSD),
      collateralTokenDelta: null,
      side: side === 'long' ? { long: {} } : { short: {} },
      priceSlippage: BigInt(5000),
      minOutput: BigInt(0),
    };
    
    const encoded = coder.encode('instantIncreasePosition', params);
    const data = Buffer.from(encoded);

    const keys = [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: collateralTokenAccount, isSigner: false, isWritable: true },
      { pubkey: PERPETUALS, isSigner: false, isWritable: false },
      { pubkey: POOL, isSigner: false, isWritable: false },
      { pubkey: positionPDA, isSigner: false, isWritable: true },
      { pubkey: custody, isSigner: false, isWritable: true },
      { pubkey: ORACLES['SOL'], isSigner: false, isWritable: false },
      { pubkey: collateralCustody, isSigner: false, isWritable: true },
      { pubkey: ORACLES['SOL'], isSigner: false, isWritable: false },
      { pubkey: collateralTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      programId: JUPITER_PERPS,
      keys,
      data,
    });
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { error: 'No wallet' };

    const custody = CUSTODIES[symbol.toUpperCase()];
    if (!custody) return { error: `Unknown: ${symbol}` };

    try {
      const wallet = this.keypair.publicKey;
      const usdcATA = this.getUSDC_ATA(wallet);
      const sizeUSD = Math.floor(amount * leverage * 1000000);

      const collateralCustody = side.toLowerCase() === 'long' ? custody : CUSTODIES['USDC'];
      const collateralTokenAccount = usdcATA;

      const tx = new Transaction();
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;

      tx.add(this.buildIncreasePositionIx(wallet, custody, collateralCustody, collateralTokenAccount, sizeUSD, side.toLowerCase()));

      console.log('Testing with Anchor encoding...');
      const sim = await this.connection.simulateTransaction(tx);
      
      if (sim.value.err) {
        console.log('Error:', JSON.stringify(sim.value.err));
        return { error: `Sim failed: ${JSON.stringify(sim.value.err)}` };
      }

      return { success: true, message: 'Position opened!' };

    } catch (e) {
      return { error: e.message };
    }
  }

  async getPositions() { return []; }
  async getAccountInfo() { return { wallet: this.walletAddress }; }
  async closePosition() { return { error: 'Use UI' }; }
}

module.exports = { JupiterPerpsService };
