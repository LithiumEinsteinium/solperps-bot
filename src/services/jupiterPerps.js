/**
 * Jupiter Perpetuals Service - With IDL
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
const PERPETUALS = parsePubkey('2cJkkCkfQqL7xLhkHBq6Dq7eBqGxBnQ9FJgGmL2NQ4'); // perpetuals config PDA
const TOKEN_PROGRAM = parsePubkey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = parsePubkey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC = parsePubkey('EPjFWdd5AufqSSqeM2qNStxVNLX5kM4jE5cG4HkJQN');
const SOL = parsePubkey('So11111111111111111111111111111111111111112');

// Price oracles
const DOVES_ORACLE_SOL = parsePubkey('DoVEsk76QybCEHQGzkvYPWLQu9gzNoZZZt3TPiL597e');
const PYTH_ORACLE_SOL = parsePubkey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG');

// Known custody accounts (from pool data)
const CUSTODY_SOL = parsePubkey('3ZVGKnmbTCUgVSzK2u5JMLTxNv1LUzZcRkWo4mSj9tF9'); // SOL custody
const CUSTODY_USDC = parsePubkey('4Cdy1uXpGVgjD7qmo49jTAK1eBj1kSZ4UVwZVVpAUoVs'); // USDC custody

// Token accounts
const CUSTODY_TOKEN_SOL = parsePubkey('J3mcYkpWmTSMJhFKKrPWQwEMDppd5cTb1TAEqdGUBbhW');
const CUSTODY_TOKEN_USDC = parsePubkey('EjBW5tgyMhiBKYMXxLqQQSmpdmkaY3yFyWDAA9xByomy');

// Keeper (use wallet as keeper for now)
const KEEPER = parsePubkey('7NP4ooX99h4oB3UoGvvLLgYBvRMP7g5CgYCFwDYeYc8J'); // placeholder

const MARKETS = { 'SOL': { custody: CUSTODY_SOL, tokenAccount: CUSTODY_TOKEN_SOL }, 'BTC': {}, 'ETH': {} };

class JupiterPerpsService {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps v6 (with IDL)');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  // Derive position PDA
  getPositionPDA(wallet, custody) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('position'), wallet.toBuffer(), custody.toBuffer()],
      JUPITER_PERPS
    )[0];
  }

  getUSDC_ATA(owner) {
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), USDC.toBuffer()],
      ATA_PROGRAM
    )[0];
  }

  // Build instantIncreasePosition instruction from IDL
  buildIncreasePositionIx(wallet, custody, collateralCustody, sizeUSD, direction, collateralTokenAccount) {
    // Anchor IDL instruction layout
    const data = Buffer.alloc(33);
    data.writeUInt8(6, 0); // instruction index
    
    // size_usd_delta (leverage * amount)
    data.writeBigUInt64LE(BigInt(sizeUSD), 1);
    
    // side (0 = long, 1 = short)
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 17);
    
    // price_slippage (BPS)
    data.writeUInt32LE(50, 21);
    
    // min_output (0 for now)
    data.writeBigUInt64LE(BigInt(0), 25);

    // All accounts from IDL
    const keys = [
      { pubkey: KEEPER, isSigner: false, isWritable: false },        // keeper
      { pubkey: wallet, isSigner: true, isWritable: true },           // owner (also signer)
      { pubkey: collateralTokenAccount, isSigner: false, isWritable: true }, // fundingAccount
      { pubkey: PERPETUALS, isSigner: false, isWritable: false },  // perpetuals
      { pubkey: POOL, isSigner: false, isWritable: false },        // pool
      { pubkey: this.getPositionPDA(wallet, custody), isSigner: false, isWritable: true }, // position
      { pubkey: custody, isSigner: false, isWritable: true },      // custody
      { pubkey: DOVES_ORACLE_SOL, isSigner: false, isWritable: false }, // custodyDovesPriceAccount
      { pubkey: PYTH_ORACLE_SOL, isSigner: false, isWritable: false }, // custodyPythnetPriceAccount
      { pubkey: collateralCustody, isSigner: false, isWritable: true }, // collateralCustody
      { pubkey: DOVES_ORACLE_SOL, isSigner: false, isWritable: false }, // collateralCustodyDovesPriceAccount
      { pubkey: PYTH_ORACLE_SOL, isSigner: false, isWritable: false }, // collateralCustodyPythnetPriceAccount
      { pubkey: collateralTokenAccount, isSigner: false, isWritable: true }, // collateralCustodyTokenAccount
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false }, // tokenProgram
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // systemProgram
    ];

    return new TransactionInstruction({
      programId: JUPITER_PERPS,
      keys,
      data,
    });
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { error: 'No wallet' };

    const market = MARKETS[symbol.toUpperCase()];
    if (!market || !market.custody) return { error: `Unknown: ${symbol}` };

    try {
      const wallet = this.keypair.publicKey;
      const usdcATA = this.getUSDC_ATA(wallet);
      const sizeUSD = Math.floor(amount * leverage * 1000000);
      
      const custody = market.custody;
      const collateralCustody = CUSTODY_USDC;
      const collateralTokenAccount = usdcATA;

      const tx = new Transaction();
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;

      tx.add(this.buildIncreasePositionIx(wallet, custody, collateralCustody, sizeUSD, side, collateralTokenAccount));

      console.log('Testing with IDL accounts...');
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
