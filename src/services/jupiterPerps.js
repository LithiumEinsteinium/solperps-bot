/**
 * Jupiter Perpetuals Service - With Anchor
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
const TOKEN_PROGRAM = parsePubkey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = parsePubkey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC = parsePubkey('EPjFWdd5AufqSSqeM2qNStxVNLX5kM4jE5cG4HkJQN');
const SOL = parsePubkey('So11111111111111111111111111111111111111112');

const MARKETS = { 'SOL': 0, 'BTC': 1, 'ETH': 2 };

class JupiterPerpsService {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.keypair = null;
    this.walletAddress = null;
    this.poolData = null;
    console.log('✅ Jupiter Perps v5 (with pool fetch)');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    // Pre-fetch pool data
    await this.fetchPoolData();
    return { success: true };
  }

  // Fetch pool to get custody addresses
  async fetchPoolData() {
    try {
      const info = await this.connection.getParsedAccountInfo(POOL);
      if (info.value) {
        // Pool data structure - need to parse
        console.log('Pool data fetched, length:', info.value.data.length);
        this.poolData = info.value.data;
      }
    } catch (e) {
      console.log('Pool fetch error:', e.message);
    }
  }

  // Derive position PDA: [position, wallet, pool, custody]
  getPositionPDA(wallet, custody) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('position'),
        wallet.toBuffer(),
        POOL.toBuffer(),
        custody.toBuffer()
      ],
      JUPITER_PERPS
    )[0];
  }

  // Get USDC ATA
  getUSDC_ATA(owner) {
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), USDC.toBuffer()],
      ATA_PROGRAM
    )[0];
  }

  // Build instruction 5: InstantIncreasePositionPreSwap
  buildPreSwapIx(wallet, positionPDA, usdcATA, custody, sizeUSD, direction) {
    const data = Buffer.alloc(40);
    data.writeUInt8(5, 0); // instruction
    data.writeBigUInt64LE(BigInt(sizeUSD), 1);  // sizeUsdDelta
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 17); // side
    data.writeUInt32LE(50, 21); // slippage 0.5%
    data.writeBigUInt64LE(BigInt(Math.floor(Date.now() / 1000)), 25); // requestTime

    // Full accounts from transaction analysis
    const priceOracle = parsePubkey('DoVEsk76QybCEHQGzkvYPWLQu9gzNoZZZt3TPiL597e');
    const referrer = parsePubkey('Ag28fGtwtpnqassHURUBsQ1WfiyaWWzDDNs4Q28qHRjv');
    const custodyTokenAccount = parsePubkey('3ZVGKnmbTCUgVSzK2u5JMLTxNv1LUzZcRkWo4mSj9tF9');
    const userTokenAccount = parsePubkey('4Cdy1uXpGVgjD7qmo49jTAK1eBj1kSZ4UVwZVVpAUoVs');

    return new TransactionInstruction({
      programId: JUPITER_PERPS,
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true },
        { pubkey: positionPDA, isSigner: false, isWritable: true },
        { pubkey: usdcATA, isSigner: false, isWritable: true },
        { pubkey: POOL, isSigner: false, isWritable: false },
        { pubkey: custody, isSigner: false, isWritable: false },
        { pubkey: custodyTokenAccount, isSigner: false, isWritable: false },
        { pubkey: priceOracle, isSigner: false, isWritable: false },
        { pubkey: referrer, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  // Build instruction 6: InstantIncreasePosition
  buildIncreaseIx(wallet, positionPDA, custody, sizeUSD, direction) {
    const data = Buffer.alloc(33);
    data.writeUInt8(6, 0);
    data.writeBigUInt64LE(BigInt(sizeUSD), 1);
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 17);
    data.writeBigUInt64LE(BigInt(0), 21); // minOutput

    const priceOracle = parsePubkey('DoVEsk76QybCEHQGzkvYPWLQu9gzNoZZZt3TPiL597e');

    return new TransactionInstruction({
      programId: JUPITER_PERPS,
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true },
        { pubkey: positionPDA, isSigner: false, isWritable: true },
        { pubkey: POOL, isSigner: false, isWritable: false },
        { pubkey: priceOracle, isSigner: false, isWritable: false },
        { pubkey: custody, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { error: 'No wallet' };

    const marketIndex = MARKETS[symbol.toUpperCase()];
    if (marketIndex === undefined) return { error: `Unknown: ${symbol}` };

    try {
      const wallet = this.keypair.publicKey;
      const usdcATA = this.getUSDC_ATA(wallet);
      const sizeUSD = Math.floor(amount * leverage * 1000000);

      // Use SOL custody as placeholder
      const custody = SOL;
      const positionPDA = this.getPositionPDA(wallet, custody);

      const tx = new Transaction();
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;

      tx.add(this.buildPreSwapIx(wallet, positionPDA, usdcATA, custody, sizeUSD, side));
      tx.add(this.buildIncreaseIx(wallet, positionPDA, custody, sizeUSD, side));

      console.log('Testing with full instruction set...');
      const sim = await this.connection.simulateTransaction(tx);
      
      if (sim.value.err) {
        console.log('Error:', JSON.stringify(sim.value.err));
        return { error: `Sim failed: ${JSON.stringify(sim.value.err)}` };
      }

      return { success: true };

    } catch (e) {
      return { error: e.message };
    }
  }

  async getPositions() { return []; }
  async getAccountInfo() { return { wallet: this.walletAddress }; }
  async closePosition() { return { error: 'Use UI' }; }
}

module.exports = { JupiterPerpsService };
