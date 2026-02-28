// This is the working InstantIncreasePosition encoder based on successful tx
const { Connection, PublicKey, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const BN = require('bn.js');

const PERP_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const JLP_POOL = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// Custodies
const CUSTODIES = {
  SOL: new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  USDC: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
};

const MINTS = {
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
};

// Event authority PDA
const EVENT_AUTHORITY = new PublicKey('37hJBDnntwqhGbK7L6M1bLyvccj4u55CCUiLPdYkiqBN');

// Working discriminator from successful tx
const INSTANT_INCREASE_DISCRIMINATOR = Buffer.from([0xde, 0x41, 0x03, 0x46, 0x8a, 0x81, 0xd5, 0x1d]);

function encodeU64(value) {
  const bn = BN.isBN(value) ? value : new BN(value.toString());
  const buf = Buffer.alloc(8);
  bn.toArray('le', 8).forEach((b, i) => buf.writeUInt8(b, i));
  return buf;
}

function encodeSide(side) {
  return Buffer.from([side.toLowerCase() === 'long' ? 1 : 2]);
}

function getATA(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM
  )[0];
}

function derivePositionPda(owner, custodyPk, collateralCustodyPk, side) {
  const sideStr = side.toLowerCase() === 'long' ? 'long' : 'short';
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), owner.toBuffer(), custodyPk.toBuffer(), collateralCustodyPk.toBuffer(), Buffer.from(sideStr)],
    PERP_PROGRAM_ID
  )[0];
}

function derivePerpetualsPda() {
  return PublicKey.findProgramAddressSync([Buffer.from('perpetuals')], PERP_PROGRAM_ID)[0];
}

// Build InstantIncreasePosition transaction (like the working tx)
async function buildOpenPositionTransaction(connection, owner, opts) {
  const { market, side, collateralTokenDelta, sizeUsdDelta, priceSlippage } = opts;
  
  const custodyPk = CUSTODIES[market];
  const collateralCustodyPk = CUSTODIES.USDC;  // USDC as collateral
  const inputMint = MINTS.USDC;
  
  const perpetualsPda = derivePerpetualsPda();
  const positionPda = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  const fundingAccount = getATA(inputMint, owner);
  
  console.log('DEBUG: Using InstantIncreasePosition (like working tx)');
  console.log('DEBUG: custodyPk=', custodyPk?.toString());
  console.log('DEBUG: fundingAccount=', fundingAccount?.toString());
  
  // Data: discriminator + sizeUsdDelta + collateralDelta + side + priceSlippage
  const data = Buffer.concat([
    INSTANT_INCREASE_DISCRIMINATOR,
    encodeU64(sizeUsdDelta),
    encodeU64(collateralTokenDelta),
    encodeSide(side),
    encodeU64(priceSlippage),
  ]);
  
  // Accounts from working transaction
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: positionPda, isSigner: false, isWritable: true },
    { pubkey: fundingAccount, isSigner: false, isWritable: true },
    { pubkey: perpetualsPda, isSigner: false, isWritable: false },
    { pubkey: JLP_POOL, isSigner: false, isWritable: true },
    { pubkey: custodyPk, isSigner: false, isWritable: true },
    { pubkey: collateralCustodyPk, isSigner: false, isWritable: true },
    { pubkey: inputMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  
  const ix = new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data,
    keys,
  });
  
  const { blockhash } = await connection.getLatestBlockhash();
  return { instructions: [ix], blockhash };
}

module.exports = {
  CUSTODIES,
  MINTS,
  buildOpenPositionTransaction,
};
