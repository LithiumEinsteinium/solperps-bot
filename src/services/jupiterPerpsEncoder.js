/**
 * Jupiter Perpetuals Encoder - Match the successful on-chain tx
 * Uses: SetTokenLedger → InstantIncreasePositionPreSwap → InstantIncreasePosition
 */

const { Connection, PublicKey, TransactionInstruction, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const BN = require('bn.js');

const PERP_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
const JLP_POOL = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const EVENT_AUTHORITY_PDA = new PublicKey('Dw274Hf6n1ir4Dw6cSA1ZSe6b445K3nNv5z9sr4j9GiV');

// CUSTODY addresses from official Jupiter docs
const CUSTODIES = {
  SOL: new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  ETH: new PublicKey('AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn'),
  BTC: new PublicKey('5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm'),
  USDC: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
  USDT: new PublicKey('4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk'),
};

// Use SOL oracle for all markets (works)
const ORACLES = {
  SOL: new PublicKey('FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh'),
};

// Discriminators from successful tx
const DISCRIMINATORS = {
  setTokenLedger: Buffer.from([144, 132, 16, 107, 88, 15, 52, 16]), // SetTokenLedger
  instantIncreasePositionPreSwap: Buffer.from([57, 36, 219, 76, 1, 50, 35, 41]), // InstantIncreasePositionPreSwap
  instantIncreasePosition: Buffer.from([98, 131, 219, 90, 68, 196, 71, 11]), // InstantIncreasePosition
};

// Helpers
function encodeU64(value) {
  const bn = BN.isBN(value) ? value : new BN(value.toString());
  const buf = Buffer.alloc(8);
  const bytes = bn.toArray('le', 8);
  bytes.forEach((b, i) => buf.writeUInt8(b, i));
  return buf;
}

function encodeSide(side) {
  return Buffer.from([side.toLowerCase() === 'long' ? 0 : 1]);
}

function getAssociatedTokenAddressSync(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM
  )[0];
}

function derivePositionPda(owner, custodyPk, collateralCustodyPk, side) {
  const seeds = [
    Buffer.from('position'),
    owner.toBuffer(),
    custodyPk.toBuffer(),
    collateralCustodyPk.toBuffer(),
    Buffer.from(side.toLowerCase() === 'long' ? 'long' : 'short'),
  ];
  const pda = PublicKey.findProgramAddressSync(seeds, PERP_PROGRAM_ID);
  return { pda: pda[0], bump: pda[1] };
}

function derivePerpetualsPda() {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('perpetuals')],
    PERP_PROGRAM_ID
  );
  return pda;
}

// Build the full position transaction (3 instructions)
async function buildOpenPositionTransaction(connection, owner, {
  market,
  side,
  collateralMint,
  collateralDelta,  // amount of collateral in millions
  sizeUsdDelta,     // position size in millions
  priceSlippage,
}) {
  const custodyPk = CUSTODIES[market];
  const collateralCustodyPk = CUSTODIES['USDC'];
  
  console.log('DEBUG: market=', market, 'custodyPk=', custodyPk?.toString());
  console.log('DEBUG: collateralMint=', collateralMint?.toString());
  
  // User's USDC ATA
  const userTokenAccount = getAssociatedTokenAddressSync(collateralMint, owner);
  console.log('DEBUG: userTokenAccount=', userTokenAccount?.toString());
  
  // Position PDA
  const { pda: positionPda } = derivePositionPda(owner, custodyPk, collateralCustodyPk, side);
  console.log('DEBUG: positionPda=', positionPda?.toString());
  
  // Perpetuals PDA
  const perpetualsPda = derivePerpetualsPda();
  console.log('DEBUG: perpetualsPda=', perpetualsPda?.toString());
  
  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  
  // Build instructions
  const instructions = [];
  
  console.log('DEBUG: Starting instruction building...');
  
  // Step 1: SetTokenLedger (tell Jupiter where to credit tokens)
  console.log('DEBUG: Building SetTokenLedger...');
  const setTokenLedgerData = Buffer.concat([
    DISCRIMINATORS.setTokenLedger,
    userTokenAccount.toBuffer(),
    encodeU64(0), // slot
  ]);
  instructions.push(
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data: setTokenLedgerData,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: perpetualsPda, isSigner: false, isWritable: false },
      ],
    })
  );
  console.log('DEBUG: SetTokenLedger done');
  
  // Step 2: InstantIncreasePositionPreSwap (swap USDC → asset)
  console.log('DEBUG: Building PreSwap...');
  console.log('DEBUG: collateralDelta=', collateralDelta?.toString());
  console.log('DEBUG: sizeUsdDelta=', sizeUsdDelta?.toString());
  console.log('DEBUG: DISCRIMINATORS.instantIncreasePositionPreSwap=', DISCRIMINATORS.instantIncreasePositionPreSwap);
  
  const preSwapData = Buffer.concat([
    DISCRIMINATORS.instantIncreasePositionPreSwap,
    encodeU64(collateralDelta),
    encodeU64(sizeUsdDelta),
    encodeSide(side),
    encodeU64(priceSlippage),
    Buffer.from([0]), // swap type (exact in)
  ]);
  
  // Get token account for market (SOL vault)
  const marketMint = new PublicKey('So11111111111111111111111111111111111111112');
  const marketTokenAccount = getAssociatedTokenAddressSync(marketMint, JLP_POOL);
  console.log('DEBUG: marketTokenAccount=', marketTokenAccount?.toString());
  
  console.log('DEBUG: pushing PreSwap instruction...');
  
  instructions.push(
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data: preSwapData,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: perpetualsPda, isSigner: false, isWritable: false },
        { pubkey: JLP_POOL, isSigner: false, isWritable: true },
        { pubkey: CUSTODIES.USDC, isSigner: false, isWritable: true },
        { pubkey: CUSTODIES.USDC, isSigner: false, isWritable: true }, // custody token account
        { pubkey: ORACLES.SOL, isSigner: false, isWritable: false },
        { pubkey: custodyPk, isSigner: false, isWritable: true },
        { pubkey: marketTokenAccount, isSigner: false, isWritable: true },
        { pubkey: ORACLES.SOL, isSigner: false, isWritable: false },
        { pubkey: collateralMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('Sysvar1nstructions1111111111111111111111111'), isSigner: false, isWritable: false },
        { pubkey: EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
        { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  );
  
  // Step 3: InstantIncreasePosition (open the position)
  const positionData = Buffer.concat([
    DISCRIMINATORS.instantIncreasePosition,
    encodeU64(collateralDelta),
    encodeU64(sizeUsdDelta),
    encodeSide(side),
    encodeU64(priceSlippage),
  ]);
  
  instructions.push(
    new TransactionInstruction({
      programId: PERP_PROGRAM_ID,
      data: positionData,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: positionPda, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: perpetualsPda, isSigner: false, isWritable: false },
        { pubkey: JLP_POOL, isSigner: false, isWritable: true },
        { pubkey: custodyPk, isSigner: false, isWritable: true },
        { pubkey: ORACLES.SOL, isSigner: false, isWritable: false },
        { pubkey: collateralCustodyPk, isSigner: false, isWritable: true },
        { pubkey: ORACLES.SOL, isSigner: false, isWritable: false },
        { pubkey: marketTokenAccount, isSigner: false, isWritable: true },
        { pubkey: collateralMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
        { pubkey: EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
        { pubkey: PERP_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  );
  
  console.log('DEBUG: All instructions built. Count:', instructions.length);
  return { instructions, blockhash };
}

module.exports = {
  CUSTODIES,
  ORACLES,
  MINTS: {
    SOL: new PublicKey('So11111111111111111111111111111111111111112'),
    USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  },
  buildOpenPositionTransaction,
};
