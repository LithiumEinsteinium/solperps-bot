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

// User-facing instruction: createIncreasePositionMarketRequest
const DISCRIM = Buffer.from([0x9d, 0xcc, 0x07, 0x06, 0xd6, 0x40, 0x22, 0x31]);

function enc64(v) { const b = Buffer.alloc(8); new BN(v).toArray('le', 8).forEach((x, i) => b.writeUInt8(x, i)); return b; }
function encSide(s) { return Buffer.from([s.toLowerCase() === 'long' ? 1 : 2]); }
function encOpt64(v) { return v ? enc64(v) : Buffer.from([0]); }

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
  
  const custody = CUSTODIES[market];
  const collateral = CUSTODIES.USDC;
  
  const fundingAccount = getATA(MINTS.USDC, owner);
  const positionPda = derivePosPda(owner, custody, collateral, side);
  
  console.log('DEBUG: Using createIncreasePositionMarketRequest (user-facing API)');
  console.log('DEBUG: fundingAccount =', fundingAccount.toString());
  
  // Data: discriminator + sizeUsdDelta + collateralTokenDelta + side + priceSlippage + jupiterMinimumOut + counter
  const data = Buffer.concat([
    DISCRIM,
    enc64(sizeUsdDelta),
    enc64(collateralTokenDelta),
    encSide(side),
    enc64(priceSlippage),
    encOpt64(null),  // jupiterMinimumOut: None
    enc64(0),        // counter: 0
  ]);
  
  // Accounts based on IDL
  const instructions = [
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: fundingAccount, isSigner: false, isWritable: true },
        { pubkey: PERPETUALS_PDA, isSigner: false, isWritable: false },
        { pubkey: JLP_POOL, isSigner: false, isWritable: false },
        { pubkey: positionPda, isSigner: false, isWritable: true },
        { pubkey: custody, isSigner: false, isWritable: false },
        { pubkey: collateral, isSigner: false, isWritable: false },
        { pubkey: MINTS.USDC, isSigner: false, isWritable: false },
        { pubkey: MINTS.SOL, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    }),
  ];
  
  const { blockhash } = await connection.getLatestBlockhash();
  return { instructions, blockhash };
}

module.exports = { CUSTODIES, MINTS, buildOpenPositionTransaction };
