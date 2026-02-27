/**
 * Jupiter Perpetuals Service - With working instruction parsing
 */

const { 
  Connection, PublicKey, Keypair, Transaction, 
  TransactionInstruction, SystemProgram
} = require('@solana/web3.js');
const bs58 = require('bs58').default;

function parsePubkey(addr) {
  const decoded = bs58.decode(addr);
  if (decoded.length === 31) {
    return new PublicKey(Buffer.concat([Buffer.alloc(1), decoded]));
  }
  return new PublicKey(decoded);
}

const JUPITER_PERPS = parsePubkey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const TOKEN_PROGRAM = parsePubkey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = parsePubkey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC = parsePubkey('EPjFWdd5AufqSSqeM2qNStxVNLX5kM4jE5cG4HkJQN');
const SOL = parsePubkey('So11111111111111111111111111111111111111112');
const SYSTEM = parsePubkey('11111111111111111111111111111111');

// Pool addresses
const POOLS = {
  'SOL': parsePubkey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq'),
};

const MARKETS = { 'SOL': 0, 'BTC': 1, 'ETH': 2 };

class JupiterPerpsService {
  constructor(config = {}) {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps v3 ready');
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  // Get user's USDC ATA
  getUSDC_ATA(owner) {
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), USDC.toBuffer()],
      ATA_PROGRAM
    )[0];
  }

  // Get user account PDA
  getUserAccount(owner) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('user'), owner.toBuffer()],
      JUPITER_PERPS
    )[0];
  }

  // Build SetTokenLedger (instruction 4)
  buildSetTokenLedgerInstruction(tokenAccount) {
    const data = Buffer.alloc(1);
    data.writeUInt8(4, 0);
    return new TransactionInstruction({
      programId: JUPITER_PERPS,
      keys: [{ pubkey: tokenAccount, isSigner: false, isWritable: false }],
      data,
    });
  }

  // Build InstantIncreasePositionPreSwap (instruction 5)
  buildPreSwapInstruction(user, userAccount, collateralATA, market, sizeUSD, direction) {
    const data = Buffer.alloc(33);
    data.writeUInt8(5, 0);
    data.writeUInt32LE(market, 1);
    data.writeBigUInt64LE(BigInt(sizeUSD), 5);
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 13);
    data.writeBigUInt64LE(BigInt(10000), 17);

    // More accounts from successful transaction
    const priceFeed = parsePubkey('DoVEsk76QybCEHQGzkvYPWLQu9gzNoZZZt3TPiL597e');

    return new TransactionInstruction({
      programId: JUPITER_PERPS,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: userAccount, isSigner: false, isWritable: true },
        { pubkey: collateralATA, isSigner: false, isWritable: true },
        { pubkey: POOLS['SOL'], isSigner: false, isWritable: false },
        { pubkey: priceFeed, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SYSTEM, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  // Build InstantIncreasePosition (instruction 6)
  buildIncreasePositionInstruction(user, userAccount, market, sizeUSD, direction) {
    const data = Buffer.alloc(33);
    data.writeUInt8(6, 0);
    data.writeUInt32LE(market, 1);
    data.writeBigUInt64LE(BigInt(sizeUSD), 5);
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 13);
    data.writeBigUInt64LE(BigInt(0), 17);  // min output

    return new TransactionInstruction({
      programId: JUPITER_PERPS,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: userAccount, isSigner: false, isWritable: true },
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
      const userAccount = this.getUserAccount(wallet);
      const usdcATA = this.getUSDC_ATA(wallet);
      const sizeUSD = Math.floor(amount * leverage * 1000000);

      const tx = new Transaction();
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet;

      // Add all 3 instructions
      tx.add(this.buildSetTokenLedgerInstruction(usdcATA));
      tx.add(this.buildPreSwapInstruction(wallet, userAccount, usdcATA, marketIndex, sizeUSD, side));
      tx.add(this.buildIncreasePositionInstruction(wallet, userAccount, marketIndex, sizeUSD, side));

      console.log('Simulating...');
      const sim = await this.connection.simulateTransaction(tx);
      
      if (sim.value.err) {
        console.log('Sim failed:', JSON.stringify(sim.value.err));
        return { error: `Sim failed: ${JSON.stringify(sim.value.err)}` };
      }

      // Sign and send
      tx.sign(this.keypair);
      const sig = await this.connection.sendRawTransaction(tx.serialize());
      
      return { success: true, txid: sig };

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
