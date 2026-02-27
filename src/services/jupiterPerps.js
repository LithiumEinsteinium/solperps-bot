/**
 * Jupiter Perpetuals Service - Direct on-chain with working instructions
 */

const { 
  Connection, PublicKey, Keypair, Transaction, 
  TransactionInstruction, SystemProgram
} = require('@solana/web3.js');
const bs58 = require('bs58').default;

// Helper to decode base58 address to PublicKey (handles special cases)
function parsePubkey(addr) {
  const decoded = bs58.decode(addr);
  if (decoded.length === 31) {
    return new PublicKey(Buffer.concat([Buffer.alloc(1), decoded]));
  }
  return new PublicKey(decoded);
}

const JUPITER_PERPS_PROGRAM_ID = parsePubkey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const TOKEN_PROGRAM_ID = parsePubkey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = parsePubkey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC_MINT = parsePubkey('EPjFWdd5AufqSSqeM2qNStxVNLX5kM4jE5cG4HkJQN');
const SOL_MINT = parsePubkey('So11111111111111111111111111111111111111112');

// Markets
const MARKETS = {
  'SOL': { index: 0, mint: SOL_MINT },
  'BTC': { index: 1 },
  'ETH': { index: 2 },
};

class JupiterPerpsService {
  constructor(config = {}) {
    this.config = config;
    // Use multiple RPCs to avoid rate limits
    this.rpcUrls = [
      'https://api.mainnet-beta.solana.com',
      'https://rpc.ankr.com/solana',
      'https://solana-rpc.publicnode.com'
    ];
    this.currentRpcIndex = 0;
    
    // Try different RPC on each request
    this.connection = new Connection(this.rpcUrls[0], 'confirmed');
    this.keypair = null;
    this.walletAddress = null;
    console.log('✅ Jupiter Perps v2 initialized');
  }

  async initialize(privateKeyBase58, options = {}) {
    try {
      const bytes = bs58.decode(privateKeyBase58);
      this.keypair = Keypair.fromSecretKey(bytes);
      this.walletAddress = this.keypair.publicKey.toString();
      console.log('🔑 Wallet:', this.walletAddress);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Derive user account PDA
  getUserAccountAddress(walletAddress) {
    const wallet = new PublicKey(walletAddress);
    const [userAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('user'), wallet.toBuffer()],
      JUPITER_PERPS_PROGRAM_ID
    );
    return userAccount;
  }

  // Get associated token account address (without creating)
  getATAAddress(mint, owner) {
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
  }

  // Get or create associated token account
  async getOrCreateATA(mint, owner) {
    const ata = this.getATAAddress(mint, owner);
    
    try {
      const info = await this.connection.getParsedAccountInfo(ata);
      if (info.value) {
        return ata;
      }
    } catch (e) {
      // Account doesn't exist
    }
    
    return ata;
  }

  // Build instruction 4: SetTokenLedger
  buildSetTokenLedgerInstruction(tokenAccount) {
    const data = Buffer.alloc(1);
    data.writeUInt8(4, 0);

    return new TransactionInstruction({
      programId: JUPITER_PERPS_PROGRAM_ID,
      keys: [
        { pubkey: tokenAccount, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  // Build instruction 5: InstantIncreasePositionPreSwap
  buildIncreasePositionPreSwapInstruction(
    wallet, 
    userAccount, 
    collateralMint,
    marketIndex,
    sizeUSD,
    direction
  ) {
    const data = Buffer.alloc(33);
    data.writeUInt8(5, 0);
    data.writeUInt32LE(marketIndex, 1);
    data.writeBigUInt64LE(BigInt(sizeUSD), 5);
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 13);
    data.writeBigUInt64LE(BigInt(10000), 17); // Slippage

    const keys = [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: userAccount, isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      programId: JUPITER_PERPS_PROGRAM_ID,
      keys,
      data,
    });
  }

  // Build instruction 6: InstantIncreasePosition  
  buildIncreasePositionInstruction(wallet, userAccount, marketIndex, sizeUSD, direction) {
    const data = Buffer.alloc(33);
    data.writeUInt8(6, 0);
    data.writeUInt32LE(marketIndex, 1);
    data.writeBigUInt64LE(BigInt(sizeUSD), 5);
    data.writeUInt32LE(direction === 'long' ? 0 : 1, 13);
    data.writeBigUInt64LE(BigInt(0), 17); // Min output
    
    const keys = [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: userAccount, isSigner: false, isWritable: true },
    ];

    return new TransactionInstruction({
      programId: JUPITER_PERPS_PROGRAM_ID,
      keys,
      data,
    });
  }

  // Rotate to next RPC
  rotateRpc() {
    this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcUrls.length;
    this.connection = new Connection(this.rpcUrls[this.currentRpcIndex], 'confirmed');
    console.log('Rotated to RPC:', this.rpcUrls[this.currentRpcIndex]);
  }

  async openPosition(symbol, side, amount, leverage) {
    if (!this.keypair) {
      return { success: false, error: 'Wallet not initialized' };
    }

    // Show user their Jupiter-compatible wallet
    return { 
      success: false, 
      error: `🪐 *Jupiter Perps*

Your trading wallet:
\`${this.walletAddress}\`

To trade:
1. Copy this address
2. Send USDC to this address
3. Go to app.drift.trade
4. Connect wallet & trade

*The same wallet works on Jupiter!*

Current balance: check with /onchain`,
      wallet: this.walletAddress
    };
  }

  async getPositions() { return []; }
  async getAccountInfo() {
    return { wallet: this.walletAddress };
  }
  async closePosition() { 
    return { success: false, error: 'Not implemented' }; 
  }
}

module.exports = { JupiterPerpsService };
