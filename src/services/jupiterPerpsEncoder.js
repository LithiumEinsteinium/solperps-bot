const { Connection, PublicKey, TransactionInstruction, SystemProgram, ComputeBudgetProgram } = require('@solana/web3.js');
const BN = require('bn.js');
// Generated instruction builders from Codama (use these instead of hand-rolling!)
// import { getInstantIncreasePositionInstruction, getIncreasePositionPreSwapInstruction } from '../generated/jupiter_idl-client/instructions';

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
  // CORRECT discriminators from Codama-generated IDL
  setTokenLedger: Buffer.from([0xe4, 0x55, 0xb9, 0x70, 0x4e, 0x4f, 0x4d, 0x02]),
  // CORRECT PreSwap: [26, 136, 225, 217, 22, 21, 83, 20]
  preSwap: Buffer.from([0x1a, 0x88, 0xe1, 0xd9, 0x16, 0x15, 0x53, 0x14]),
  // CORRECT InstantIncreasePosition from Codama: [164, 126, 68, 182, 223, 166, 64, 183]
  instantIncrease: Buffer.from([0xa4, 0x7e, 0x44, 0xb6, 0xdf, 0xa6, 0x40, 0xb7]),
};

function enc64(v) { const b = Buffer.alloc(8); new BN(v).toArray('le', 8).forEach((x, i) => b.writeUInt8(x, i)); return b; }
function encI64(v) { const b = Buffer.alloc(8); const arr = new BN(v).toTwos(64).toArray('le', 8); arr.forEach((x, i) => b.writeUInt8(x, i)); return b; }
function encSide(s) { return Buffer.from([s.toLowerCase() === 'long' ? 1 : 2]); }
// Option<u64> encoding: 1 byte variant (0=None, 1=Some) + 8 bytes value if Some
function encOption64(v) { if (v === null || v === undefined || v === 0n) return Buffer.from([0]); return Buffer.concat([Buffer.from([1]), enc64(v)]); }

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

  // Skip PreSwap - go directly to InstantIncreasePosition
  // Step 6: InstantIncreasePosition
  // Data: discriminator(8) + sizeUsdDelta(8) + collateralTokenDelta(Option<u64>, 1+8) + side(1) + priceSlippage(8) + requestTime(8)
  const requestTime = Math.floor(Date.now() / 1000);
  const instantData = Buffer.concat([
    DISCR.instantIncrease,           // 8 bytes
    enc64(sizeUsdDelta),              // 8 bytes
    encOption64(collateralDelta),     // 1 + 8 bytes (Option<u64>)
    encSide(side),                    // 1 byte
    enc64(priceSlippage),             // 8 bytes
    encI64(requestTime)               // 8 bytes
  ]);
  
  // Token Ledger PDA
  const TOKEN_LEDGER = new PublicKey('J3mcYkpWmTSMJhFKKrPWQwEMDppd5cTb1TAEqdGUBbhW');
  
  instructions.push(new TransactionInstruction({
    programId: PERP_PROGRAM_ID,
    data: instantData,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },             // 1. keeper (signer)
      { pubkey: owner, isSigner: true, isWritable: true },            // 2. apiKeeper (signer) - use owner
      { pubkey: owner, isSigner: true, isWritable: true },            // 3. owner (signer)
      { pubkey: userUsdcAta, isSigner: false, isWritable: true },     // 4. fundingAccount (USDC)
      { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false }, // 5. perpetuals
      { pubkey: JLP_POOL, isSigner: false, isWritable: true },        // 6. pool
      { pubkey: positionPda, isSigner: false, isWritable: true },    // 7. position
      { pubkey: custody, isSigner: false, isWritable: true },         // 8. custody (SOL)
      { pubkey: DOVE_PRICE_SOL, isSigner: false, isWritable: false }, // 9. custodyDovesPriceAccount
      { pubkey: DOVE_PRICE_SOL, isSigner: false, isWritable: false }, // 10. custodyPythnetPriceAccount
      { pubkey: collateral, isSigner: false, isWritable: true },       // 11. collateralCustody (USDC)
      { pubkey: DOVE_PRICE_USDC, isSigner: false, isWritable: false }, // 12. collateralCustodyDovesPriceAccount
      { pubkey: DOVE_PRICE_USDC, isSigner: false, isWritable: false }, // 13. collateralCustodyPythnetPriceAccount
      { pubkey: poolUsdcVault, isSigner: false, isWritable: true },    // 14. collateralCustodyTokenAccount
      { pubkey: TOKEN_LEDGER, isSigner: false, isWritable: false },    // 15. tokenLedger
      { pubkey: owner, isSigner: false, isWritable: false },           // 16. referral (use owner)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 17. tokenProgram
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 18. systemProgram
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false }, // 19. eventAuthority
      { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },  // 20. program
    ],
  }));

  const { blockhash } = await connection.getLatestBlockhash();
  return { instructions, blockhash };
}

module.exports = { CUSTODIES, MINTS, buildOpenPositionTransaction };
