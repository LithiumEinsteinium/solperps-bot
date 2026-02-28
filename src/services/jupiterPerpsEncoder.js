const { Connection, PublicKey, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const BN = require('bn.js');

const PERP_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const JLP_POOL = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const EVENT_AUTHORITY = new PublicKey('37hJBDnntwqhGbK7L6M1bLyvccj4u55CCUiLPdYkiqBN');
const PERPETUALS_PDA = new PublicKey('H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj');

const CUSTODIES = {
  SOL: new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  USDC: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
};

const MINTS = {
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
};

const ORACLE_SOL = new PublicKey('FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh');

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

async function buildOpenPositionTransaction(connection, owner, opts) {
  const { market, side, collateralTokenDelta, sizeUsdDelta, priceSlippage } = opts;
  
  const custody = CUSTODIES[market];  // SOL
  const collateral = CUSTODIES.USDC;
  const inputMint = MINTS.USDC;
  
  const tokenLedger = getATA(inputMint, owner);  // USDC ATA
  const positionPda = derivePosPda(owner, custody, collateral, side);
  
  const poolInput = getATA(inputMint, JLP_POOL);      // Pool's USDC ATA
  const poolOutput = getATA(MINTS.SOL, JLP_POOL);    // Pool's SOL ATA
  
  console.log('tokenLedger:', tokenLedger.toString());
  console.log('poolInput:', poolInput.toString());
  console.log('poolOutput:', poolOutput.toString());
  
  const instructions = [];
  
  // Step 1: SetTokenLedger (3 accounts)
  const setData = Buffer.concat([DISCR.setTokenLedger, tokenLedger.toBuffer(), enc64(0)]);
  instructions.push(new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data: setData,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: tokenLedger, isSigner: false, isWritable: true },
      { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
    ],
  }));
  
  // Step 2: PreSwap (16 accounts)
  const preData = Buffer.concat([DISCR.preSwap, enc64(collateralTokenDelta), enc64(sizeUsdDelta), encSide(side), enc64(priceSlippage)]);
  instructions.push(new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data: preData,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: tokenLedger, isSigner: false, isWritable: true },
      { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
      { pubkey: JLP_POOL, isSigner: false, isWritable: true },
      { pubkey: collateral, isSigner: false, isWritable: true },
      { pubkey: poolInput, isSigner: false, isWritable: true },
      { pubkey: poolOutput, isSigner: false, isWritable: true },
      { pubkey: MINTS.SOL, isSigner: false, isWritable: false },
      { pubkey: inputMint, isSigner: false, isWritable: false },
      { pubkey: custody, isSigner: false, isWritable: true },
      { pubkey: ORACLE_SOL, isSigner: false, isWritable: false },
      { pubkey: ORACLE_SOL, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('Sysvar1nstructions1111111111111111111111111'), isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  }));
  
  // Step 3: InstantIncreasePosition (20 accounts)
  const instData = Buffer.concat([DISCR.instantIncrease, enc64(sizeUsdDelta), enc64(collateralTokenDelta), encSide(side), enc64(priceSlippage)]);
  instructions.push(new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data: instData,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: tokenLedger, isSigner: false, isWritable: true },
      { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
      { pubkey: JLP_POOL, isSigner: false, isWritable: true },
      { pubkey: custody, isSigner: false, isWritable: true },
      { pubkey: collateral, isSigner: false, isWritable: true },
      { pubkey: poolOutput, isSigner: false, isWritable: true },
      { pubkey: inputMint, isSigner: false, isWritable: false },
      { pubkey: ORACLE_SOL, isSigner: false, isWritable: false },
      { pubkey: ORACLE_SOL, isSigner: false, isWritable: false },
      { pubkey: ORACLE_SOL, isSigner: false, isWritable: false },
      { pubkey: poolInput, isSigner: false, isWritable: true },
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
