/**
 * Jupiter Perpetuals Encoder
 *
 * Uses the correct user-facing instructions from the Jupiter Perps IDL:
 *   1. createIncreasePositionMarketRequest  — user signs, submits collateral
 *   2. createDecreasePositionMarketRequest  — user signs to close
 *
 * Jupiter's off-chain keepers then execute the request automatically.
 * This is the ONLY flow available to end users; "instantIncreasePosition"
 * requires keeper signers controlled by Jupiter and cannot be called directly.
 *
 * Program: PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu
 */

const {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} = require('@solana/web3.js');
const BN = require('bn.js');

const PERP_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID  = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const JLP_POOL = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');

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

const EVENT_AUTHORITY = new PublicKey('Dw274Hf6n1ir4Dw6cSA1ZSe6b445K3nNv5z9sr4j9GiV');

const DISCRIMINATORS = {
  createIncreasePositionMarketRequest: Buffer.from([183, 198, 97, 169, 35, 1, 225, 57]),
  createDecreasePositionMarketRequest: Buffer.from([147, 238, 76, 91, 48, 86, 167, 253]),
};

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
  const s = side.toLowerCase();
  if (s === 'long')  return Buffer.from([1]);
  if (s === 'short') return Buffer.from([2]);
  throw new Error(`Unknown side: ${side}`);
}

function getAssociatedTokenAddress(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID
  )[0];
}

function derivePositionPda(owner, custodyPk, collateralCustodyPk, side) {
  const sideStr = side.toLowerCase() === 'long' ? 'long' : 'short';
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), owner.toBuffer(), custodyPk.toBuffer(), collateralCustodyPk.toBuffer(), Buffer.from(sideStr)],
    PERP_PROGRAM_ID
  );
  return pda;
}

function derivePerpetualsPda() {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('perpetuals')], PERP_PROGRAM_ID);
  return pda;
}

function derivePositionRequestPda(owner, positionPda, counter) {
  const counterBuf = Buffer.alloc(8);
  const counterBN = BN.isBN(counter) ? counter : new BN(counter.toString());
  counterBN.toArray('le', 8).forEach((b, i) => counterBuf.writeUInt8(b, i));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position_request'), owner.toBuffer(), positionPda.toBuffer(), counterBuf],
    PERP_PROGRAM_ID
  );
  return pda;
}

async function buildOpenPositionTransaction(connection, owner, opts) {
  // Accept both old param name (collateralDelta) and new canonical name (collateralTokenDelta)
  const {
    market,
    side,
    collateralTokenDelta,
    collateralDelta,          // legacy alias
    sizeUsdDelta,
    priceSlippage,
    jupiterMinimumOut = null,
    counter = 0,
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

  const { blockhash } = await connection.getLatestBlockhash();

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
    { pubkey: owner,               isSigner: true,  isWritable: true  },
    { pubkey: fundingAccount,      isSigner: false, isWritable: true  },
    { pubkey: perpetualsPda,       isSigner: false, isWritable: false },
    { pubkey: JLP_POOL,            isSigner: false, isWritable: false },
    { pubkey: positionPda,         isSigner: false, isWritable: true  },
    { pubkey: positionRequestPda,  isSigner: false, isWritable: true  },
    { pubkey: positionRequestAta,  isSigner: false, isWritable: true  },
    { pubkey: custodyPk,           isSigner: false, isWritable: false },
    { pubkey: collateralCustodyPk, isSigner: false, isWritable: false },
    { pubkey: inputMint,           isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false },
    { pubkey: ATA_PROGRAM_ID,      isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: EVENT_AUTHORITY,     isSigner: false, isWritable: false },
    { pubkey: PERP_PROGRAM_ID,     isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({ programId: PERP_PROGRAM_ID, keys, data });
  return { instructions: [instruction], blockhash, positionRequestPda };
}

async function buildClosePositionTransaction(connection, owner, opts) {
  const { market, side, collateralUsdDelta, sizeUsdDelta, priceSlippage, entirePosition = true, jupiterMinimumOut = null, counter = 0 } = opts;

  if (!CUSTODIES[market]) throw new Error(`Unknown market: ${market}`);

  const custodyPk           = CUSTODIES[market];
  const collateralCustodyPk = CUSTODIES['USDC'];
  const desiredMint         = MINTS.USDC;
  const perpetualsPda       = derivePerpetualsPda();
  const receivingAccount    = getAssociatedTokenAddress(desiredMint, owner);
  const positionPda         = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  const positionRequestPda  = derivePositionRequestPda(owner, positionPda, counter);
  const positionRequestAta  = getAssociatedTokenAddress(desiredMint, positionRequestPda);

  const { blockhash } = await connection.getLatestBlockhash();

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
    { pubkey: owner,               isSigner: true,  isWritable: true  },
    { pubkey: receivingAccount,    isSigner: false, isWritable: true  },
    { pubkey: perpetualsPda,       isSigner: false, isWritable: false },
    { pubkey: JLP_POOL,            isSigner: false, isWritable: false },
    { pubkey: positionPda,         isSigner: false, isWritable: true  },
    { pubkey: positionRequestPda,  isSigner: false, isWritable: true  },
    { pubkey: positionRequestAta,  isSigner: false, isWritable: true  },
    { pubkey: custodyPk,           isSigner: false, isWritable: false },
    { pubkey: collateralCustodyPk, isSigner: false, isWritable: false },
    { pubkey: desiredMint,         isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false },
    { pubkey: ATA_PROGRAM_ID,      isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: EVENT_AUTHORITY,     isSigner: false, isWritable: false },
    { pubkey: PERP_PROGRAM_ID,     isSigner: false, isWritable: false },
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
