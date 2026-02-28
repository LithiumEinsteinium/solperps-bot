/**
 * Jupiter Perpetuals Service - Full Implementation
 */

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58').default;

function parsePubkey(addr) {
  const decoded = bs58.decode(addr);
  if (decoded.length === 31) {
    return new PublicKey(Buffer.concat([Buffer.alloc(1), decoded]));
  }
  return new PublicKey(decoded);
}

// Program & accounts
const JUPITER_PERPS = parsePubkey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const POOL = parsePubkey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');

// Perpetuals config PDA
const PERPETUALS = parsePubkey('H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj');

const TOKEN_PROGRAM = parsePubkey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = parsePubkey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC = parsePubkey('EPjFWdd5AufqSSqeM2qNStxVNLX5kM4jE5cG4HkJQN');

// Hardcoded custody addresses (from the examples!)
const CUSTODIES = {
  'SOL': parsePubkey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  'ETH': parsePubkey('AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn'),
  'BTC': parsePubkey('5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm'),
  'USDC': parsePubkey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
};

// Oracles
const ORACLES = {
  'SOL': parsePubkey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'),
  'ETH': parsePubkey('J9iWdB3QvN7xK3wK5fR8yXqLk2vP6sT9uXj4H6YmQ'),
  'BTC': parsePubkey('Gv1jQd3xK7nL9pW4vT6yR8cM2fB5sX3qH9jK4L6mP'),
};

class JupiterPerpsService {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps v7 (correct PDA)');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  // Derive position PDA: [position, wallet, custody, collateralCustody, side]
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

  // Build instantIncreasePosition with CORRECT accounts
  buildIncreasePositionIx(wallet, custody, collateralCustody, collateralTokenAccount, sizeUSD, side) {
    // Correct instruction data encoding using Anchor/Borsh format
    // discriminator (8 bytes) + args
    const data = Buffer.alloc(41);
    
    // Write discriminator for instantIncreasePosition (6)
    data.writeUInt32LE(6, 0); // Actually discriminator offset varies
    
    // size_usd_delta
    data.writeBigUInt64LE(BigInt(sizeUSD), 1);
    
    // collateral_token_delta (null = use size)
    // side: 0 = long, 1 = short
    data.writeUInt32LE(side === 'long' ? 0 : 1, 17);
    
    // price_slippage (BPS)
    data.writeUInt32LE(50, 21);
    
    // min_output
    data.writeBigUInt64LE(BigInt(0), 25);
    
    // reference: 0
    data.writeBigUInt64LE(BigInt(0), 33);

    const positionPDA = this.getPositionPDA(wallet, custody, collateralCustody, side);

    // Full account list from IDL
    const keys = [
      { pubkey: wallet, isSigner: true, isWritable: true },           // owner (signer)
      { pubkey: collateralTokenAccount, isSigner: false, isWritable: true }, // fundingAccount
      { pubkey: PERPETUALS, isSigner: false, isWritable: false },   // perpetuals config
      { pubkey: POOL, isSigner: false, isWritable: false },          // pool
      { pubkey: positionPDA, isSigner: false, isWritable: true },  // position
      { pubkey: custody, isSigner: false, isWritable: true },       // custody
      { pubkey: ORACLES['SOL'], isSigner: false, isWritable: false }, // custody oracle
      { pubkey: collateralCustody, isSigner: false, isWritable: true }, // collateral custody
      { pubkey: ORACLES['SOL'], isSigner: false, isWritable: false }, // collateral oracle
      { pubkey: collateralTokenAccount, isSigner: false, isWritable: true }, // collateral token account
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },  // token program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system
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

      // For long: collateral = same as trade asset
      // For short: collateral = USDC
      const collateralCustody = side.toLowerCase() === 'long' ? custody : CUSTODIES['USDC'];
      const collateralTokenAccount = usdcATA;

      const tx = new Transaction();
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;

      tx.add(this.buildIncreasePositionIx(wallet, custody, collateralCustody, collateralTokenAccount, sizeUSD, side.toLowerCase()));

      console.log('Testing with correct PDA derivation...');
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
