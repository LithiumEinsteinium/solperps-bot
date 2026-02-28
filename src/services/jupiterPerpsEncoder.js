'use strict';

/**
 * Jupiter Perpetuals Encoder - Verified Addresses
 * From official Jupiter docs: dev.jup.ag/docs/perps
 */

const {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} = require('@solana/web3.js');

const BN = require('bn.js');

// Program & Pool
const PERP_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const JLP_POOL = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');

const [PERPETUALS_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('perpetuals')],
  PERP_PROGRAM_ID
);

const [EVENT_AUTHORITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('__event_authority')],
  PERP_PROGRAM_ID
);

// CUSTODY PDAs - Official from Jupiter docs
const CUSTODIES = {
  SOL:  new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  ETH:  new PublicKey('AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn'),
  BTC:  new PublicKey('5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm'),
  USDC: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
  USDT: new PublicKey('4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk'),
};

// CUSTODY TOKEN ACCOUNTS - Token vaults (need to fetch from chain or use known)
const CUSTODY_TOKEN_ACCOUNTS = {
  SOL:  new PublicKey('3x6CbBGFoJnKsJkUj3FHGN4WfCb6nFfFT5G36fq8n1oU'),
  ETH:  new PublicKey('FqRDpM9Z5xHJJTNJTEEwLKBc9NXe7ENkwSAy4ARMRJR'),
  BTC:  new PublicKey('7TGG8ZoN67VBgpWPMYcXnXLDvr8FBXHNVUdp7jSdMrDH'),
  USDC: new PublicKey('9zBoMsWEQTyBLGXDwTHUNnw4M47wfF2SnjA6sMJ5j7rT'),
  USDT: new PublicKey('Bv9A9PsZPJj8cYMVcCgxFQdyMBkZkEeNBLYFcNHT4qVV'),
};

// ORACLES - Edge/Chaos Labs (official from Jupiter Support)
const ORACLE_ACCOUNTS = {
  SOL:  new PublicKey('FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh'),
  ETH:  new PublicKey('AFZnHPzy4mvVCffrVwhewHbFc93uTHvDSFrVH7GtfXF1'),
  BTC:  new PublicKey('hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC'),
  USDC: new PublicKey('6Jp2xZUTWdDD2ZyUPRzeMdc6AFQ5K3pFgZxk2EijfjnM'),
  USDT: new PublicKey('Fgc93D641F8N2d1xLjQ4jmShuD3GE3BsCXA56KBQbF5u'),
};

// MINTS
const MINTS = {
  SOL:  new PublicKey('So11111111111111111111111111111111111111112'),
  ETH:  new PublicKey('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'),
  BTC:  new PublicKey('9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
};

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// Discriminators (8-byte SHA256)
const DISCRIMINATORS = {
  createIncreasePositionMarketRequest: Buffer.from([184, 85, 199, 24, 105, 171, 156, 56]),
  createDecreasePositionMarketRequest: Buffer.from([74, 198, 195, 86, 193, 99, 1, 79]),
};

// Borsh helpers
function encodeU64(value) {
  const bn = BN.isBN(value) ? value : new BN(value.toString());
  const buf = Buffer.alloc(8);
  const bytes = bn.toArray('le', 8);
  bytes.forEach((b, i) => buf.writeUInt8(b, i));
  return buf;
}

function encodeOption(value, encodeFn) {
  if (value == null) return Buffer.from([0x00]);
  return Buffer.concat([Buffer.from([0x01]), encodeFn(value)]);
}

function encodeSide(side) {
  return Buffer.from([side.toLowerCase() === 'long' ? 0 : 1]);
}

function encodeRequestChange(change) {
  return Buffer.from([change === 'Increase' ? 0 : 1]);
}

// ATA Derivation
function getAssociatedTokenAddressSync(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID
  )[0];
}

// PDA Derivation
function derivePositionPda(owner, custodyPk, collateralCustodyPk, side) {
  const sideByte = side.toLowerCase() === 'long' ? 0 : 1;
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('position'),
      owner.toBuffer(),
      custodyPk.toBuffer(),
      collateralCustodyPk.toBuffer(),
      Buffer.from([sideByte]),
    ],
    PERP_PROGRAM_ID
  );
  return { pda, bump };
}

function derivePositionRequestPda(positionPda, direction, counter) {
  const counterBuf = Buffer.alloc(8);
  const bytes = counter.toArray('le', 8);
  bytes.forEach((b, i) => counterBuf.writeUInt8(b, i));

  const [pda, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('position_request'),
      positionPda.toBuffer(),
      Buffer.from(direction),
      counterBuf,
    ],
    PERP_PROGRAM_ID
  );
  return { pda, bump };
}

function randomCounter() {
  const { randomBytes } = require('crypto');
  return new BN(randomBytes(8).toString('hex'), 16);
}

// Create Increase Position Market Request
function createIncreasePositionMarketRequest({
  owner,
  market,
  side,
  collateralMint,
  collateralDelta,
  sizeUsdDelta,
  priceSlippage,
  jupiterMinimumOut = null,
}) {
  const custodyPk = CUSTODIES[market];
  const collateralCustodyPk = side.toLowerCase() === 'long'
    ? custodyPk
    : CUSTODIES['USDC'];

  const { pda: positionPda } = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  const counter = randomCounter();
  const { pda: positionRequestPda } = derivePositionRequestPda(positionPda, 'increase', counter);

  const positionRequestAta = getAssociatedTokenAddressSync(collateralMint, positionRequestPda);

  // Data encoding
  const data = Buffer.concat([
    DISCRIMINATORS.createIncreasePositionMarketRequest,
    encodeU64(collateralDelta),
    encodeU64(sizeUsdDelta),
    encodeRequestChange('Increase'),
    encodeSide(side),
    encodeU64(priceSlippage),
    encodeOption(jupiterMinimumOut, encodeU64),
    encodeU64(counter),
  ]);

  const collateralMarket = side.toLowerCase() === 'long' ? market : 'USDC';

  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
    { pubkey: JLP_POOL, isSigner: false, isWritable: true },
    { pubkey: positionPda, isSigner: false, isWritable: true },
    { pubkey: positionRequestPda, isSigner: false, isWritable: true },
    { pubkey: positionRequestAta, isSigner: false, isWritable: true },
    { pubkey: custodyPk, isSigner: false, isWritable: true },
    { pubkey: CUSTODY_TOKEN_ACCOUNTS[market], isSigner: false, isWritable: true },
    { pubkey: ORACLE_ACCOUNTS[market], isSigner: false, isWritable: false },
    { pubkey: collateralCustodyPk, isSigner: false, isWritable: true },
    { pubkey: ORACLE_ACCOUNTS[collateralMarket], isSigner: false, isWritable: false },
    { pubkey: CUSTODY_TOKEN_ACCOUNTS[collateralMarket], isSigner: false, isWritable: true },
    { pubkey: collateralMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
    { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ keys, programId: PERP_PROGRAM_ID, data });
}

// Build transactions
async function buildOpenPositionTransaction(connection, owner, params) {
  const { ComputeBudgetProgram, VersionedTransaction, TransactionMessage } = require('@solana/web3.js');

  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
  const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
  const openIx = createIncreasePositionMarketRequest({ ...params, owner });

  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: blockhash,
    instructions: [cuLimitIx, cuPriceIx, openIx],
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

module.exports = {
  PERP_PROGRAM_ID,
  JLP_POOL,
  CUSTODIES,
  CUSTODY_TOKEN_ACCOUNTS,
  ORACLE_ACCOUNTS,
  MINTS,
  createIncreasePositionMarketRequest,
  buildOpenPositionTransaction,
};
