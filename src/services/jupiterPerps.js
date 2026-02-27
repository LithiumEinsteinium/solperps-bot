/**
 * Jupiter Perpetuals Service - Simplified
 */

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction } = require('@solana/web3.js');
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
const POOL_SOL = parsePubkey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');

class JupiterPerpsService {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.keypair = null;
    this.walletAddress = null;
  }

  async initialize(privateKeyBase58) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
    this.walletAddress = this.keypair.publicKey.toString();
    return { success: true };
  }

  getUserAccount(wallet) {
    return PublicKey.findProgramAddressSync([Buffer.from('user'), wallet.toBuffer()], JUPITER_PERPS)[0];
  }

  getUSDC_ATA(owner) {
    return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), USDC.toBuffer()], ATA_PROGRAM)[0];
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) return { error: 'No wallet' };
    
    return { 
      error: `🪐 *Jupiter Perps*

Your wallet: \`${this.walletAddress}\`

To trade:
1. Send USDC to this address
2. Go to app.drift.trade
3. Connect & trade

Same wallet works everywhere!`,
      wallet: this.walletAddress
    };
  }

  async getPositions() {
    if (!this.keypair) return [];
    return [];
  }

  async getAccountInfo() {
    if (!this.walletAddress) return null;
    return { wallet: this.walletAddress };
  }

  async closePosition() { return { error: 'Use UI' }; }
}

module.exports = { JupiterPerpsService };
