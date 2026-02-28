/**
 * Jupiter Perpetuals Encoder
 *
 * ROOT CAUSE OF BUG:
 * The previous version tried to call `instantIncreasePosition` directly on the
 * Jupiter Perps program. That instruction is NOT user-callable — it is only
 * invoked by Jupiter's off-chain keeper bots. Sending it directly caused:
 *
 *   AnchorError: InstructionFallbackNotFound (error 0x65 = 101)
 *
 * The program received an unrecognised discriminator, fell through to its
 * fallback handler, which is explicitly disabled → crash.
 *
 * THE FIX:
 * Jupiter Perps uses a two-phase keeper model:
 *   1. User sends  createIncreasePositionMarketRequest  → creates a PositionRequest PDA on-chain
 *   2. Jupiter's keeper detects the PDA and executes the actual trade
 *
 * Discriminators are computed the standard Anchor way:
 *   sha256("global:<camelCaseInstructionName>")[0..8]
 */

const {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} = require('@solana/web3.js');
const BN = require('bn.js');
const crypto = require('crypto');

// ── Program / pool constants ──────────────────────────────────────────────────
const PERP_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const JLP_POOL        = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');
const TOKEN_PROGRAM   = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM     = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const EVENT_AUTHORITY = new PublicKey('Dw274Hf6n1ir4Dw6cSA1ZSe6b445K3nNv5z9sr4j9GiV');

// ── Custody (market) accounts ─────────────────────────────────────────────────
const CUSTODIES = {
  SOL:  new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  ETH:  new PublicKey('AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn'),
  BTC:  new PublicKey('5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm'),
  USDC: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
  USDT: new PublicKey('4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk'),
};

// ── Token mints ───────────────────────────────────────────────────────────────
const MINTS = {
  SOL:  new PublicKey('So11111111111111111111111111111111111111112'),
  ETH:  new PublicKey('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'),
  BTC:  new PublicKey('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
};

// ── Anchor discriminator helper ───────────────────────────────────────────────
// Standard formula: sha256("global:<instructionName>")[0..8]
function anchorDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

const DISCRIMINATORS = {
  createIncreasePositionMarketRequest: anchorDiscriminator('createIncreasePositionMarketRequest'),
  createDecreasePositionMarketRequest: anchorDiscriminator('createDecreasePositionMarketRequest'),
};

// ── Borsh encoding helpers ────────────────────────────────────────────────────
function encodeU64(value) {
  const bn = BN.isBN(value) ? value : new BN(value.toString());
  const buf = Buffer.alloc(8);
  bn.toArray('le', 8).forEach((b, i) => buf.writeUInt8(b, i));
  return buf;
}

// Side enum from IDL: None=0, Long=1, Short=2
function encodeSide(side) {
  return Buffer.from([side.toLowerCase() === 'long' ? 1 : 2]);
}

// Option<u64>: 0x00 = None, 0x01 + u64 = Some(value)
function encodeOptionU64(value) {
  if (value == null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeU64(value)]);
}

// Option<bool>: 0x00 = None, 0x01 + 0x00/0x01 = Some(false/true)
function encodeOptionBool(value) {
  if (value == null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), Buffer.from([value ? 1 : 0])]);
}

// ── PDA derivation helpers ────────────────────────────────────────────────────
function getATA(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM
  )[0];
}

function derivePerpetualsPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('perpetuals')],
    PERP_PROGRAM_ID
  )[0];
}

function derivePositionPda(owner, custodyPk, collateralCustodyPk, side) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('position'),
      owner.toBuffer(),
      custodyPk.toBuffer(),
      collateralCustodyPk.toBuffer(),
      Buffer.from(side.toLowerCase() === 'long' ? 'long' : 'short'),
    ],
    PERP_PROGRAM_ID
  )[0];
}

// PositionRequest PDA: seeds = ["position_request", positionPda, counter_u64_le]
function derivePositionRequestPda(positionPda, counter) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position_request'), positionPda.toBuffer(), encodeU64(counter)],
    PERP_PROGRAM_ID
  )[0];
}

// ── Build open-position transaction ──────────────────────────────────────────
/**
 * Builds a single-instruction transaction calling
 * createIncreasePositionMarketRequest on the Jupiter Perps program.
 *
 * Jupiter's keeper service monitors the resulting PositionRequest PDA and
 * executes the actual trade — typically within a few seconds.
 *
 * @param {Connection} connection
 * @param {PublicKey}  owner
 * @param {object}     opts
 * @param {string}     opts.market              'SOL' | 'ETH' | 'BTC'
 * @param {string}     opts.side                'long' | 'short'
 * @param {PublicKey}  opts.collateralMint      USDC mint
 * @param {BN}         opts.collateralTokenDelta collateral in USDC lamports (6 dp)
 * @param {BN}         opts.sizeUsdDelta        position size in USD (6 dp)
 * @param {BN}         opts.priceSlippage       max slippage in USD (6 dp)
 * @param {number}     opts.counter             nonce to make PositionRequest PDA unique (default 0)
 */
async function buildOpenPositionTransaction(connection, owner, opts) {
  const {
    market,
    side,
    collateralMint,
    collateralTokenDelta,
    sizeUsdDelta,
    priceSlippage,
    counter = 0,
  } = opts;

  const custodyPk           = CUSTODIES[market];
  const collateralCustodyPk = CUSTODIES['USDC'];
  if (!custodyPk) throw new Error(`Unknown market: ${market}`);

  const perpetualsPda      = derivePerpetualsPda();
  const positionPda        = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  const positionRequestPda = derivePositionRequestPda(positionPda, counter);
  const positionRequestAta = getATA(collateralMint, positionRequestPda);
  const fundingAccount     = getATA(collateralMint, owner);

  console.log('DEBUG: perpetualsPda=', perpetualsPda.toString());
  console.log('DEBUG: positionPda=', positionPda.toString());
  console.log('DEBUG: positionRequestPda=', positionRequestPda.toString());
  console.log('DEBUG: fundingAccount=', fundingAccount.toString());
  console.log('DEBUG: discriminator=', DISCRIMINATORS.createIncreasePositionMarketRequest.toString('hex'));

  // Borsh-encode CreateIncreasePositionMarketRequestParams (field order from IDL):
  //   sizeUsdDelta:          u64
  //   collateralTokenDelta:  u64
  //   side:                  Side (enum u8 variant: Long=1, Short=2)
  //   priceSlippage:         u64
  //   jupiterMinimumOut:     Option<u64>
  //   counter:               u64
  const data = Buffer.concat([
    DISCRIMINATORS.createIncreasePositionMarketRequest,
    encodeU64(sizeUsdDelta),
    encodeU64(collateralTokenDelta),
    encodeSide(side),
    encodeU64(priceSlippage),
    encodeOptionU64(null),   // jupiterMinimumOut: None
    encodeU64(counter),
  ]);

  // Account order matches IDL exactly (referral omitted — it is optional)
  const ix = new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data,
    keys: [
      { pubkey: owner,               isSigner: true,  isWritable: true  }, // owner
      { pubkey: fundingAccount,      isSigner: false, isWritable: true  }, // fundingAccount
      { pubkey: perpetualsPda,       isSigner: false, isWritable: false }, // perpetuals
      { pubkey: JLP_POOL,            isSigner: false, isWritable: false }, // pool
      { pubkey: positionPda,         isSigner: false, isWritable: true  }, // position
      { pubkey: positionRequestPda,  isSigner: false, isWritable: true  }, // positionRequest
      { pubkey: positionRequestAta,  isSigner: false, isWritable: true  }, // positionRequestAta
      { pubkey: custodyPk,           isSigner: false, isWritable: false }, // custody
      { pubkey: collateralCustodyPk, isSigner: false, isWritable: false }, // collateralCustody
      { pubkey: collateralMint,      isSigner: false, isWritable: false }, // inputMint
      { pubkey: TOKEN_PROGRAM,       isSigner: false, isWritable: false }, // tokenProgram
      { pubkey: ATA_PROGRAM,         isSigner: false, isWritable: false }, // associatedTokenProgram
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // systemProgram
      { pubkey: EVENT_AUTHORITY,     isSigner: false, isWritable: false }, // eventAuthority
      { pubkey: PERP_PROGRAM_ID,     isSigner: false, isWritable: false }, // program (self-CPI)
    ],
  });

  const { blockhash } = await connection.getLatestBlockhash();
  return { instructions: [ix], blockhash };
}

// ── Build close-position transaction ─────────────────────────────────────────
/**
 * Builds a createDecreasePositionMarketRequest transaction.
 * Set entirePosition=true to close the whole position.
 */
async function buildClosePositionTransaction(connection, owner, opts) {
  const {
    market,
    side,
    collateralUsdDelta = new BN(0),
    sizeUsdDelta       = new BN(0),
    priceSlippage      = new BN(1_000_000),
    entirePosition     = true,
    counter            = 0,
  } = opts;

  const custodyPk           = CUSTODIES[market];
  const collateralCustodyPk = CUSTODIES['USDC'];
  const desiredMint         = MINTS['USDC'];
  if (!custodyPk) throw new Error(`Unknown market: ${market}`);

  const perpetualsPda      = derivePerpetualsPda();
  const positionPda        = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  const positionRequestPda = derivePositionRequestPda(positionPda, counter);
  const positionRequestAta = getATA(desiredMint, positionRequestPda);
  const receivingAccount   = getATA(desiredMint, owner);

  // Borsh-encode CreateDecreasePositionMarketRequestParams (field order from IDL):
  //   collateralUsdDelta: u64
  //   sizeUsdDelta:       u64
  //   priceSlippage:      u64
  //   jupiterMinimumOut:  Option<u64>
  //   entirePosition:     Option<bool>
  //   counter:            u64
  const data = Buffer.concat([
    DISCRIMINATORS.createDecreasePositionMarketRequest,
    encodeU64(collateralUsdDelta),
    encodeU64(sizeUsdDelta),
    encodeU64(priceSlippage),
    encodeOptionU64(null),
    encodeOptionBool(entirePosition),
    encodeU64(counter),
  ]);

  const ix = new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data,
    keys: [
      { pubkey: owner,               isSigner: true,  isWritable: true  }, // owner
      { pubkey: receivingAccount,    isSigner: false, isWritable: true  }, // receivingAccount
      { pubkey: perpetualsPda,       isSigner: false, isWritable: false }, // perpetuals
      { pubkey: JLP_POOL,            isSigner: false, isWritable: false }, // pool
      { pubkey: positionPda,         isSigner: false, isWritable: false }, // position
      { pubkey: positionRequestPda,  isSigner: false, isWritable: true  }, // positionRequest
      { pubkey: positionRequestAta,  isSigner: false, isWritable: true  }, // positionRequestAta
      { pubkey: custodyPk,           isSigner: false, isWritable: false }, // custody
      { pubkey: collateralCustodyPk, isSigner: false, isWritable: false }, // collateralCustody
      { pubkey: desiredMint,         isSigner: false, isWritable: false }, // desiredMint
      { pubkey: TOKEN_PROGRAM,       isSigner: false, isWritable: false }, // tokenProgram
      { pubkey: ATA_PROGRAM,         isSigner: false, isWritable: false }, // associatedTokenProgram
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // systemProgram
      { pubkey: EVENT_AUTHORITY,     isSigner: false, isWritable: false }, // eventAuthority
      { pubkey: PERP_PROGRAM_ID,     isSigner: false, isWritable: false }, // program
    ],
  });

  const { blockhash } = await connection.getLatestBlockhash();
  return { instructions: [ix], blockhash };
}

module.exports = {
  CUSTODIES,
  MINTS,
  DISCRIMINATORS,
  buildOpenPositionTransaction,
  buildClosePositionTransaction,
};
