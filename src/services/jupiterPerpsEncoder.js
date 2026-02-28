/**
 * Jupiter Perpetuals Encoder
 *
 * Instruction layout derived directly from jupiter_idl.json (on-chain IDL).
 *
 * createIncreasePositionMarketRequest — 16 accounts, referral at index 10
 * createDecreasePositionMarketRequest — 16 accounts, referral at index 10
 *
 * Program: PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu
 */

const {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} = require('@solana/web3.js');
const BN = require('bn.js');

const PERP_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID  = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const JLP_POOL        = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');
const EVENT_AUTHORITY = new PublicKey('Dw274Hf6n1ir4Dw6cSA1ZSe6b445K3nNv5z9sr4j9GiV');

// No referral — use default (system program) as a null stand-in.
// Jupiter UI passes SystemProgram.programId when there is no referral.
const NO_REFERRAL = SystemProgram.programId;

const CUSTODIES = {
  SOL:  new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  ETH:  new PublicKey('AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn'),
  BTC:  new PublicKey('5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm'),
  USDC: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
  USDT: new PublicKey('4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk'),
};

const MINTS = {
  SOL:  new PublicKey('So11111111111111111111111111111111111111112'),
  ETH:  new PublicKey('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'),
  BTC:  new PublicKey('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
};

const ORACLES = {
  SOL:  { doves: new PublicKey('H6ARHf6YXhGYeQfUzQNGFQt2S1pLXALi5gVKJSUG8Zr4'), pythnet: new PublicKey('J83w4HKfqxwcq3BEMMkwFREF7Lu91zqMp16xsaUSb4R3') },
  ETH:  { doves: new PublicKey('EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw'), pythnet: new PublicKey('2Gbig7xSMEimtHmXrGEf63RAHSGPtFhzBGdnFKxaW53P') },
  BTC:  { doves: new PublicKey('GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU'), pythnet: new PublicKey('8ihFLu5FimgTQ1Unh4dVyEHUGodJ738b9Q7gWwKXB3Y8') },
  USDC: { doves: new PublicKey('Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btez1oNyXRTBvLhd'), pythnet: new PublicKey('Dp3HCUDzxcvqA4J86cBtN8PFMRR3XLrHEQvUGqkmXsJK') },
};

// Discriminators = sha256("global:<camelCaseInstructionName>")[0:8]
// Verified against jupiter_idl.json instruction names.
const DISCRIMINATORS = {
  createIncreasePositionMarketRequest: Buffer.from([157, 204, 7, 6, 214, 64, 34, 49]),
  createDecreasePositionMarketRequest: Buffer.from([198, 150, 56, 176, 53, 17, 59, 146]),
};

// ==================== ENCODING HELPERS ====================

function encodeU64(value) {
  const bn = BN.isBN(value) ? value : new BN(value.toString());
  const buf = Buffer.alloc(8);
  bn.toArray('le', 8).forEach((b, i) => buf.writeUInt8(b, i));
  return buf;
}

function encodeOptionU64(value) {
  if (value == null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeU64(value)]);
}

function encodeOptionBool(value) {
  if (value == null) return Buffer.from([0]);
  return Buffer.from([1, value ? 1 : 0]);
}

function encodeSide(side) {
  // Side enum: None=0, Long=1, Short=2
  const s = side.toLowerCase();
  if (s === 'long')  return Buffer.from([1]); // Borsh C-enum: Long=1
  if (s === 'short') return Buffer.from([2]); // Borsh C-enum: Short=2
  throw new Error(`Unknown side: ${side}`);
}

// ==================== PDA HELPERS ====================

function getAssociatedTokenAddress(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID
  )[0];
}

function derivePositionPda(owner, custodyPk, collateralCustodyPk, side) {
  const sideStr = side.toLowerCase() === 'long' ? 'long' : 'short';
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('position'),
      owner.toBuffer(),
      custodyPk.toBuffer(),
      collateralCustodyPk.toBuffer(),
      Buffer.from(sideStr),
    ],
    PERP_PROGRAM_ID
  );
  return pda;
}

function derivePerpetualsPda() {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('perpetuals')],
    PERP_PROGRAM_ID
  );
  return pda;
}

function derivePositionRequestPda(owner, positionPda, counter) {
  const counterBuf = Buffer.alloc(8);
  const counterBN = BN.isBN(counter) ? counter : new BN(counter.toString());
  counterBN.toArray('le', 8).forEach((b, i) => counterBuf.writeUInt8(b, i));
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('position_request'),
      owner.toBuffer(),
      positionPda.toBuffer(),
      counterBuf,
    ],
    PERP_PROGRAM_ID
  );
  return pda;
}

// ==================== TRANSACTION BUILDERS ====================

/**
 * Build a createIncreasePositionMarketRequest instruction.
 *
 * IDL account order (16 accounts):
 *  0  owner                  mut signer
 *  1  fundingAccount         mut
 *  2  perpetuals             readonly
 *  3  pool                   readonly
 *  4  position               mut
 *  5  positionRequest        mut
 *  6  positionRequestAta     mut
 *  7  custody                readonly
 *  8  collateralCustody      readonly
 *  9  inputMint              readonly
 * 10  referral               readonly   ← was missing in previous version
 * 11  tokenProgram           readonly
 * 12  associatedTokenProgram readonly
 * 13  systemProgram          readonly
 * 14  eventAuthority         readonly
 * 15  program                readonly
 */
async function buildOpenPositionTransaction(connection, owner, opts) {
  const {
    market,
    side,
    collateralTokenDelta,
    collateralDelta,        // legacy alias
    sizeUsdDelta,
    priceSlippage,
    jupiterMinimumOut = null,
    counter = 0,
    referral = null,        // optional referral PublicKey
  } = opts;

  const collateral = collateralTokenDelta || collateralDelta;
  if (!collateral) throw new Error('collateralTokenDelta is required');
  if (!CUSTODIES[market]) throw new Error(`Unknown market: ${market}`);

  const custodyPk           = CUSTODIES[market];
  const collateralCustodyPk = CUSTODIES['USDC'];
  const inputMint           = MINTS.USDC;
  const perpetualsPda       = derivePerpetualsPda();
  const fundingAccount      = getAssociatedTokenAddress(inputMint, owner);
  const positionPda         = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  const positionRequestPda  = derivePositionRequestPda(owner, positionPda, counter);
  const positionRequestAta  = getAssociatedTokenAddress(inputMint, positionRequestPda);
  const referralPk          = referral ? new PublicKey(referral) : NO_REFERRAL;

  const { blockhash } = await connection.getLatestBlockhash();

  // Params: CreateIncreasePositionMarketRequestParams
  // Fields (in IDL order): sizeUsdDelta, collateralTokenDelta, side, priceSlippage, jupiterMinimumOut, counter
  const paramsData = Buffer.concat([
    encodeU64(sizeUsdDelta),
    encodeU64(collateral),
    encodeSide(side),
    encodeU64(priceSlippage),
    encodeOptionU64(jupiterMinimumOut),
    encodeU64(counter),
  ]);

  const data = Buffer.concat([DISCRIMINATORS.createIncreasePositionMarketRequest, paramsData]);

  const keys = [
    { pubkey: owner,               isSigner: true,  isWritable: true  }, //  0
    { pubkey: fundingAccount,      isSigner: false, isWritable: true  }, //  1
    { pubkey: perpetualsPda,       isSigner: false, isWritable: false }, //  2
    { pubkey: JLP_POOL,            isSigner: false, isWritable: false }, //  3
    { pubkey: positionPda,         isSigner: false, isWritable: true  }, //  4
    { pubkey: positionRequestPda,  isSigner: false, isWritable: true  }, //  5
    { pubkey: positionRequestAta,  isSigner: false, isWritable: true  }, //  6
    { pubkey: custodyPk,           isSigner: false, isWritable: false }, //  7
    { pubkey: collateralCustodyPk, isSigner: false, isWritable: false }, //  8
    { pubkey: inputMint,           isSigner: false, isWritable: false }, //  9
    { pubkey: referralPk,          isSigner: false, isWritable: false }, // 10 referral
    { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false }, // 11
    { pubkey: ATA_PROGRAM_ID,      isSigner: false, isWritable: false }, // 12
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 13
    { pubkey: EVENT_AUTHORITY,     isSigner: false, isWritable: false }, // 14
    { pubkey: PERP_PROGRAM_ID,     isSigner: false, isWritable: false }, // 15
  ];

  const instruction = new TransactionInstruction({ programId: PERP_PROGRAM_ID, keys, data });
  return { instructions: [instruction], blockhash, positionRequestPda };
}

/**
 * Build a createDecreasePositionMarketRequest instruction.
 *
 * IDL account order (16 accounts):
 *  0  owner                  mut signer
 *  1  receivingAccount       mut
 *  2  perpetuals             readonly
 *  3  pool                   readonly
 *  4  position               readonly   ← IDL says isMut=false
 *  5  positionRequest        mut
 *  6  positionRequestAta     mut
 *  7  custody                readonly
 *  8  collateralCustody      readonly
 *  9  desiredMint            readonly
 * 10  referral               readonly   ← was missing in previous version
 * 11  tokenProgram           readonly
 * 12  associatedTokenProgram readonly
 * 13  systemProgram          readonly
 * 14  eventAuthority         readonly
 * 15  program                readonly
 */
async function buildClosePositionTransaction(connection, owner, opts) {
  const {
    market,
    side,
    collateralUsdDelta,
    sizeUsdDelta,
    priceSlippage,
    entirePosition = true,
    jupiterMinimumOut = null,
    counter = 0,
    referral = null,
  } = opts;

  if (!CUSTODIES[market]) throw new Error(`Unknown market: ${market}`);

  const custodyPk           = CUSTODIES[market];
  const collateralCustodyPk = CUSTODIES['USDC'];
  const desiredMint         = MINTS.USDC;
  const perpetualsPda       = derivePerpetualsPda();
  const receivingAccount    = getAssociatedTokenAddress(desiredMint, owner);
  const positionPda         = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  const positionRequestPda  = derivePositionRequestPda(owner, positionPda, counter);
  const positionRequestAta  = getAssociatedTokenAddress(desiredMint, positionRequestPda);
  const referralPk          = referral ? new PublicKey(referral) : NO_REFERRAL;

  const { blockhash } = await connection.getLatestBlockhash();

  // Params: CreateDecreasePositionMarketRequestParams
  // Fields (in IDL order): collateralUsdDelta, sizeUsdDelta, priceSlippage, jupiterMinimumOut, entirePosition, counter
  const paramsData = Buffer.concat([
    encodeU64(collateralUsdDelta),
    encodeU64(sizeUsdDelta),
    encodeU64(priceSlippage),
    encodeOptionU64(jupiterMinimumOut),
    encodeOptionBool(entirePosition ? true : null),
    encodeU64(counter),
  ]);

  const data = Buffer.concat([DISCRIMINATORS.createDecreasePositionMarketRequest, paramsData]);

  const keys = [
    { pubkey: owner,               isSigner: true,  isWritable: true  }, //  0
    { pubkey: receivingAccount,    isSigner: false, isWritable: true  }, //  1
    { pubkey: perpetualsPda,       isSigner: false, isWritable: false }, //  2
    { pubkey: JLP_POOL,            isSigner: false, isWritable: false }, //  3
    { pubkey: positionPda,         isSigner: false, isWritable: false }, //  4 readonly per IDL
    { pubkey: positionRequestPda,  isSigner: false, isWritable: true  }, //  5
    { pubkey: positionRequestAta,  isSigner: false, isWritable: true  }, //  6
    { pubkey: custodyPk,           isSigner: false, isWritable: false }, //  7
    { pubkey: collateralCustodyPk, isSigner: false, isWritable: false }, //  8
    { pubkey: desiredMint,         isSigner: false, isWritable: false }, //  9
    { pubkey: referralPk,          isSigner: false, isWritable: false }, // 10 referral
    { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false }, // 11
    { pubkey: ATA_PROGRAM_ID,      isSigner: false, isWritable: false }, // 12
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 13
    { pubkey: EVENT_AUTHORITY,     isSigner: false, isWritable: false }, // 14
    { pubkey: PERP_PROGRAM_ID,     isSigner: false, isWritable: false }, // 15
  ];

  const instruction = new TransactionInstruction({ programId: PERP_PROGRAM_ID, keys, data });
  return { instructions: [instruction], blockhash, positionRequestPda };
}

module.exports = {
  CUSTODIES,
  MINTS,
  ORACLES,
  buildOpenPositionTransaction,
  buildClosePositionTransaction,
  derivePositionPda,
  derivePerpetualsPda,
  derivePositionRequestPda,
  getAssociatedTokenAddress,
};
