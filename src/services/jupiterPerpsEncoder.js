const { Connection, PublicKey, TransactionInstruction, SystemProgram, ComputeBudgetProgram } = require('@solana/web3.js');
const BN = require('bn.js');

const PERP_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const JLP_POOL = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const EVENT_AUTHORITY = new PublicKey('Dw274Hf6n1ir4Dw6cSA1ZSe6b445K3nNv5z9sr4j9GiV');
const PERPETUALS_PDA = new PublicKey('H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj');

const CUSTODIES = {
  SOL: new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  USDC: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
};
const MINTS = {
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
};

// Derived addresses
const TRANSFER_AUTHORITY = new PublicKey('AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49');
const DOVE_PRICE_USDC = new PublicKey('6Jp2xZUTWdDD2ZyUPRzeMdc6AFQ5K3pFgZxk2EijfjnM');
const DOVE_PRICE_SOL = new PublicKey('FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh');

const DISCR = {
  setTokenLedger: Buffer.from([0x7c, 0x2f, 0x27, 0x32, 0xf5, 0x9e, 0x01, 0xa0]),
  // PreSwap: 16 bytes (2 discriminators)
  preSwap: Buffer.from([0x27, 0x24, 0xb7, 0x6d, 0x30, 0x11, 0x63, 0x28, 0xfa, 0x3f, 0x5b, 0xe7, 0xe5, 0xcb, 0x1f, 0x53]),
  // InstantIncreasePosition: 16 bytes (2 discriminators)
  instantIncrease: Buffer.from([0xe2, 0x28, 0x0d, 0xdb, 0x06, 0x44, 0x43, 0x24, 0x41, 0x86, 0x90, 0x3c, 0x90, 0x41, 0x46, 0x09]),
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
  const { market, side, collateralDelta, sizeUsdDelta, priceSlippage } = opts;
  
  const custody = CUSTODIES[market];
  const collateral = CUSTODIES.USDC;
  
  const userUsdcAta = getATA(MINTS.USDC, owner);
  const userSolAta = getATA(MINTS.SOL, owner);
  
  // Pool token accounts (vaults)
  const poolUsdcVault = new PublicKey('WzWUoCmtVv7eqAbU3BfKPU3fhLP6CXR8NCJH78UK9VS');
  const poolSolVault = new PublicKey('BUvduFTd2sWFagCunBPLupG8fBTJqweLw9DuhruNFSCm');
  
  const positionPda = derivePosPda(owner, custody, collateral, side);
  
  console.log('userUsdcAta:', userUsdcAta.toString());
  console.log('userSolAta:', userSolAta.toString());
  
  const instructions = [];
  
  // Step 1: SetComputeUnitLimit
  instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
  
  // Step 2: SetComputeUnitPrice
  instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000 }));
  
  // Step 3: CreateIdempotent - create user's SOL ATA
  instructions.push(
    new TransactionInstruction({
      programId: ATA_PROGRAM,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: userSolAta, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: MINTS.SOL, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    })
  );
  
  // Step 4: SetTokenLedger
  instructions.push(new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data: DISCR.setTokenLedger,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: userSolAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  }));
  
  // Step 5: PreSwap (16 byte discriminator) (16 accounts - exact order from Solscan)
  const preData = Buffer.concat([DISCR.preSwap, enc64(collateralDelta), enc64(sizeUsdDelta), encSide(side), enc64(priceSlippage)]);
  instructions.push(new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data: preData,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },           // 1. Owner
      { pubkey: userUsdcAta, isSigner: false, isWritable: true },    // 2. Funding Account (USDC)
      { pubkey: userSolAta, isSigner: false, isWritable: true },     // 3. Receiving Account (SOL)
      { pubkey: TRANSFER_AUTHORITY, isSigner: false, isWritable: false }, // 4. Transfer Authority
      { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false }, // 5. Perpetuals
      { pubkey: JLP_POOL, isSigner: false, isWritable: true },       // 6. Pool
      { pubkey: collateral, isSigner: false, isWritable: true },      // 7. Receiving Custody (USDC)
      { pubkey: DOVE_PRICE_USDC, isSigner: false, isWritable: false }, // 8. Dove Price USDC
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },   // 9. Receiving Custody Token Account
      { pubkey: custody, isSigner: false, isWritable: true },        // 10. Dispensing Custody (SOL)
      { pubkey: DOVE_PRICE_SOL, isSigner: false, isWritable: false }, // 11. Dove Price SOL
      { pubkey: poolSolVault, isSigner: false, isWritable: true },    // 12. Dispensing Custody Token Account
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 13. Token Program
      { pubkey: new PublicKey('Sysvar1nstructions1111111111111111111111111'), isSigner: false, isWritable: false }, // 14. Sysvar
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false }, // 15. Event Authority
      { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false }, // 16. Program
    ],
  }));
  
  // Step 6: InstantIncreasePosition (same accounts essentially)
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
      { pubkey: poolSolVault, isSigner: false, isWritable: true },
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },
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
