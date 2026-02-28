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

// Fixed addresses from working tx
const ORACLES = {
  SOL: new PublicKey('FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh'),
};

const DISCRIM = {
  setTokenLedger: Buffer.from([0x7c, 0x2f, 0x27, 0x32, 0xf5, 0x9e, 0x01, 0xa0]),
  preSwap: Buffer.from([0x27, 0x24, 0xb7, 0x6d, 0x30, 0x11, 0x63, 0x28]),
  instantIncrease: Buffer.from([0xe2, 0x28, 0x0d, 0xdb, 0x06, 0x44, 0x43, 0x24]),
};

function encodeU64(v) { const b = Buffer.alloc(8); new BN(v).toArray('le', 8).forEach((x, i) => b.writeUInt8(x, i)); return b; }
function encodeSide(s) { return Buffer.from([s.toLowerCase() === 'long' ? 1 : 2]); }

function getATA(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM
  )[0];
}

function derivePositionPda(owner, custodyPk, collateralCustodyPk, side) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), owner.toBuffer(), custodyPk.toBuffer(), collateralCustodyPk.toBuffer(), Buffer.from(side.toLowerCase() === 'long' ? 'long' : 'short')],
    PERP_PROGRAM_ID
  )[0];
}

async function buildOpenPositionTransaction(connection, owner, opts) {
  const { market, side, collateralTokenDelta, sizeUsdDelta, priceSlippage } = opts;
  
  const custodyPk = CUSTODIES[market]; // SOL custody
  const collateralCustodyPk = CUSTODIES.USDC;
  
  // User's USDC ATA (not SOL!)
  const userUsdcAta = getATA(MINTS.USDC, owner);
  const positionPda = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  
  // Pool accounts
  const poolUsdcAta = getATA(MINTS.USDC, JLP_POOL);
  const poolSolAta = getATA(MINTS.SOL, JLP_POOL);
  
  console.log('DEBUG: userUsdcAta (funding) =', userUsdcAta.toString());
  console.log('DEBUG: poolSolAta =', poolSolAta.toString());
  console.log('DEBUG: poolUsdcAta =', poolUsdcAta.toString());
  
  const instructions = [];
  
  // Step 1: SetTokenLedger (point to user's USDC ATA - pool will provide SOL)
  const setData = Buffer.concat([DISCRIM.setTokenLedger, userUsdcAta.toBuffer(), encodeU64(0)]);
  instructions.push(
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data: setData,
      keys: [
        { pubkey: userUsdcAta, isSigner: false, isWritable: true },
        { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
      ],
    })
  );
  
  // Step 2: PreSwap - pool provides SOL, takes USDC
  const preData = Buffer.concat([DISCRIM.preSwap, encodeU64(collateralTokenDelta), encodeU64(sizeUsdDelta), encodeSide(side), encodeU64(priceSlippage)]);
  instructions.push(
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data: preData,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: userUsdcAta, isSigner: false, isWritable: true },
        { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
        { pubkey: JLP_POOL, isSigner: false, isWritable: true },
        { pubkey: collateralCustodyPk, isSigner: false, isWritable: true },
        { pubkey: poolUsdcAta, isSigner: false, isWritable: true },
        { pubkey: poolSolAta, isSigner: false, isWritable: true },
        { pubkey: MINTS.SOL, isSigner: false, isWritable: false },
        { pubkey: MINTS.USDC, isSigner: false, isWritable: false },
        { pubkey: custodyPk, isSigner: false, isWritable: true },
        { pubkey: ORACLES.SOL, isSigner: false, isWritable: false },
        { pubkey: ORACLES.SOL, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('Sysvar1nstructions1111111111111111111111111'), isSigner: false, isWritable: false },
        { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  );
  
  // Step 3: InstantIncreasePosition
  const instantData = Buffer.concat([DISCRIM.instantIncrease, encodeU64(sizeUsdDelta), encodeU64(collateralTokenDelta), encodeSide(side), encodeU64(priceSlippage)]);
  instructions.push(
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data: instantData,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: positionPda, isSigner: false, isWritable: true },
        { pubkey: userUsdcAta, isSigner: false, isWritable: true },
        { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
        { pubkey: JLP_POOL, isSigner: false, isWritable: true },
        { pubkey: custodyPk, isSigner: false, isWritable: true },
        { pubkey: collateralCustodyPk, isSigner: false, isWritable: true },
        { pubkey: MINTS.SOL, isSigner: false, isWritable: false },
        { pubkey: ORACLES.SOL, isSigner: false, isWritable: false },
        { pubkey: ORACLES.SOL, isSigner: false, isWritable: false },
        { pubkey: poolSolAta, isSigner: false, isWritable: true },
        { pubkey: poolUsdcAta, isSigner: false, isWritable: true },
        { pubkey: MINTS.USDC, isSigner: false, isWritable: false },
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

module.exports = { CUSTODIES, MINTS, buildOpenPositionTransaction };
