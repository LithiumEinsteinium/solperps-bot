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
const PERPETUALS_PDA = new PublicKey('H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj');

// Discriminators from user's successful transaction
const SET_TOKEN_LEDGER_DISCRIMINATOR = Buffer.from([0x7c, 0x2f, 0x27, 0x32, 0xf5, 0x9e, 0x01, 0xa0]); // fC8nMvWeAaD
const PRE_SWAP_DISCRIMINATOR = Buffer.from([0x27, 0x24, 0xb7, 0x6d, 0x30, 0x11, 0x63, 0x28]); // JyS3bTARYyj6P1vn5csfUw
const INSTANT_INCREASE_DISCRIMINATOR = Buffer.from([0xe2, 0x28, 0x0d, 0xdb, 0x06, 0x44, 0x43, 0x24]); // e2280ddb06444324

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

// Build 3-instruction transaction like user's successful tx
async function buildOpenPositionTransaction(connection, owner, opts) {
  const { market, side, collateralTokenDelta, sizeUsdDelta, priceSlippage } = opts;
  
  // Use SOL as collateral (like working tx)
  const collateralMint = MINTS.SOL;
  const custodyPk = CUSTODIES[market]; // SOL custody
  const collateralCustodyPk = CUSTODIES.USDC;
  
  const fundingAccount = getATA(collateralMint, owner);  // User's SOL ATA
  const positionPda = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  
  console.log('DEBUG: Using 3-step process like working tx');
  console.log('DEBUG: collateralMint=SOL (native), fundingAccount=', fundingAccount.toString());
  
  const instructions = [];
  
  // Step 1: SetTokenLedger
  const setTokenLedgerData = Buffer.concat([
    SET_TOKEN_LEDGER_DISCRIMINATOR,
    fundingAccount.toBuffer(),
    encodeU64(0),
  ]);
  instructions.push(
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data: setTokenLedgerData,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: fundingAccount, isSigner: false, isWritable: true },
        { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
      ],
    })
  );
  
  // Step 2: InstantIncreasePositionPreSwap
  const preSwapData = Buffer.concat([
    PRE_SWAP_DISCRIMINATOR,
    encodeU64(collateralTokenDelta),
    encodeU64(sizeUsdDelta),
    encodeSide(side),
    encodeU64(priceSlippage),
  ]);
  
  // Get SOL token account for pool
  const poolSolAccount = getATA(MINTS.SOL, JLP_POOL);
  
  instructions.push(
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data: preSwapData,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: fundingAccount, isSigner: false, isWritable: true },
        { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
        { pubkey: JLP_POOL, isSigner: false, isWritable: true },
        { pubkey: collateralCustodyPk, isSigner: false, isWritable: true },
        { pubkey: fundingAccount, isSigner: false, isWritable: true }, // custody token account
        { pubkey: poolSolAccount, isSigner: false, isWritable: true },
        { pubkey: collateralMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  );
  
  // Step 3: InstantIncreasePosition
  const instantData = Buffer.concat([
    INSTANT_INCREASE_DISCRIMINATOR,
    encodeU64(sizeUsdDelta),
    encodeU64(collateralTokenDelta),
    encodeSide(side),
    encodeU64(priceSlippage),
  ]);
  
  instructions.push(
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data: instantData,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: positionPda, isSigner: false, isWritable: true },
        { pubkey: fundingAccount, isSigner: false, isWritable: true },
        { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
        { pubkey: JLP_POOL, isSigner: false, isWritable: true },
        { pubkey: custodyPk, isSigner: false, isWritable: true },
        { pubkey: collateralCustodyPk, isSigner: false, isWritable: true },
        { pubkey: collateralMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  );
  
  const { blockhash } = await connection.getLatestBlockhash();
  return { instructions, blockhash };
}

module.exports = {
  CUSTODIES,
  MINTS,
  buildOpenPositionTransaction,
};
