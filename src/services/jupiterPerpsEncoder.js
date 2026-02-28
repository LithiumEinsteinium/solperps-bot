const { Connection, PublicKey, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const { ComputeBudgetProgram } = require('@solana/web3.js');
const BN = require('bn.js');

const PERP_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const JLP_POOL = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const EVENT_AUTHORITY = new PublicKey('Dw274Hf6n1ir4Dw6cSA1ZSe6b445K3nNv5z9sr4j9GiV');
const PERPETUALS_PDA = new PublicKey('H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj');

// Known addresses from working tx
const TOKEN_LEDGER = new PublicKey('J3mcYkpWmTSMJhFKKrPWQwEMDppd5cTb1TAEqdGUBbhW');
const CUSTODIES = {
  SOL: new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  USDC: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
};
const MINTS = {
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
};
const ORACLE = new PublicKey('FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh');

const DISCR = {
  setTokenLedger: Buffer.from([0x7c, 0x2f, 0x27, 0x32, 0xf5, 0x9e, 0x01, 0xa0]),
  preSwap: Buffer.from([0x27, 0x24, 0xb7, 0x6d, 0x30, 0x11, 0x63, 0x28]),
  instantIncrease: Buffer.from([0xe2, 0x28, 0x0d, 0xdb, 0x06, 0x44, 0x43, 0x24]),
};

function enc64(v) { const b = Buffer.alloc(8); new BN(v).toArray('le', 8).forEach((x, i) => b.writeUInt8(x, i)); return b; }
function encSide(s) { return Buffer.from([s.toLowerCase() === 'long' ? 1 : 2]); }

function getATA(mint, owner) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}

function derivePosPda(owner, custody, collateral, side) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), owner.toBuffer(), custody.toBuffer(), collateral.toBuffer(), Buffer.from(side.toLowerCase() === 'long' ? 'long' : 'short')],
    PERP_PROGRAM_ID
  )[0];
}

// Get pool token accounts
function getPoolTokenAccount(mint) {
  return getATA(mint, JLP_POOL);
}

async function buildOpenPositionTransaction(connection, owner, opts) {
  const { market, side, collateralDelta, sizeUsdDelta, priceSlippage } = opts;
  
  const custody = CUSTODIES[market]; // SOL
  const collateral = CUSTODIES.USDC;
  
  // User's token accounts
  const userUsdcAta = getATA(MINTS.USDC, owner);
  const userSolAta = getATA(MINTS.SOL, owner);
  
  // Pool token accounts
  const poolUsdcAta = getPoolTokenAccount(MINTS.USDC);
  const poolSolAta = getPoolTokenAccount(MINTS.SOL);
  
  // Position PDA
  const positionPda = derivePosPda(owner, custody, collateral, side);
  
  console.log('DEBUG: userSolAta =', userSolAta.toString());
  console.log('DEBUG: userUsdcAta =', userUsdcAta.toString());
  console.log('DEBUG: TOKEN_LEDGER =', TOKEN_LEDGER.toString());
  
  const instructions = [];
  
  // Step 1: SetComputeUnitLimit
  instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
  
  // Step 2: SetComputeUnitPrice
  instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000 }));
  
  // Step 3: CreateIdempotent - create user's SOL ATA
  // (This is handled by the system, but we include it conceptually)
  
  // Step 4: SetTokenLedger (with Token Ledger PDA)
  const setTokenData = DISCR.setTokenLedger;
  instructions.push(new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data: setTokenData,
    keys: [
      { pubkey: TOKEN_LEDGER, isSigner: false, isWritable: true },
      { pubkey: userSolAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  }));
  
  // Step 5: PreSwap
  const preData = Buffer.concat([DISCR.preSwap, enc64(collateralDelta), enc64(sizeUsdDelta), encSide(side), enc64(priceSlippage)]);
  instructions.push(new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data: preData,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: userUsdcAta, isSigner: false, isWritable: true },
      { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
      { pubkey: JLP_POOL, isSigner: false, isWritable: true },
      { pubkey: collateral, isSigner: false, isWritable: true },
      { pubkey: poolUsdcAta, isSigner: false, isWritable: true },
      { pubkey: poolSolAta, isSigner: false, isWritable: true },
      { pubkey: MINTS.SOL, isSigner: false, isWritable: false },
      { pubkey: MINTS.USDC, isSigner: false, isWritable: false },
      { pubkey: custody, isSigner: false, isWritable: true },
      { pubkey: ORACLE, isSigner: false, isWritable: false },
      { pubkey: ORACLE, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('Sysvar1nstructions1111111111111111111111111'), isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  }));
  
  // Step 6: InstantIncreasePosition
  const instantData = Buffer.concat([DISCR.instantIncrease, enc64(sizeUsdDelta), enc64(collateralDelta), encSide(side), enc64(priceSlippage)]);
  instructions.push(new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data: instantData,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: userSolAta, isSigner: false, isWritable: true },
      { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
      { pubkey: JLP_POOL, isSigner: false, isWritable: true },
      { pubkey: custody, isSigner: false, isWritable: true },
      { pubkey: collateral, isSigner: false, isWritable: true },
      { pubkey: poolSolAta, isSigner: false, isWritable: true },
      { pubkey: MINTS.USDC, isSigner: false, isWritable: false },
      { pubkey: ORACLE, isSigner: false, isWritable: false },
      { pubkey: ORACLE, isSigner: false, isWritable: false },
      { pubkey: poolUsdcAta, isSigner: false, isWritable: true },
      { pubkey: MINTS.SOL, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  }));
  
  const { blockhash } = await connection.getLatestBlockhash();
  return { instructions, blockhash };
}

module.exports = { CUSTODIES, MINTS, buildOpenPositionTransaction };
