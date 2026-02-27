# Perpetuals Trading Implementation Plan

## Target: Drift Protocol
- Established perp DEX on Solana (since 2021)
- TypeScript SDK available
- Up to 10x leverage
- Cross-margin system

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Telegram Bot                       │
│  /long SOL 10x → /short BTC 5x → /closepos         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              PerpetualsService                       │
│  - Open/close positions                             │
│  - Get position info                                │
│  - Get account state                                │
│  - Funding rate queries                             │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Drift SDK (Local)                       │
│  - User's private key signs txs                     │
│  - Bot builds & broadcasts                          │
└─────────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Setup
- [ ] Install Drift SDK
- [ ] Configure RPC/cluster
- [ ] Get Drift program IDs

### Phase 2: Core Functions
- [ ] Initialize user account (if new)
- [ ] Open long/short position
- [ ] Close position
- [ ] Get open positions

### Phase 3: Telegram Commands
- [ ] `/perp SOL long 10 5` — Open 5x long on SOL
- [ ] `/perp BTC short 1 10` — Open 10x short on BTC
- [ ] `/perpclose 12345` — Close position
- [ ] `/perppositions` — List perp positions
- [ ] `/perpinfo` — Account info, collateral

### Phase 4: Risk Management
- [ ] Liquidation warnings
- [ ] Position health display
- [ ] Leverage warnings

## Supported Markets (Initial)
- SOL-PERP
- BTC-PERP  
- ETH-PERP

## Drift SDK Usage

```javascript
const { DriftClient, BN, Wallet } = require('@drift-labs/protocol');

// Initialize
const wallet = new Wallet(keypair);
const driftClient = new DriftClient({
  connection,
  wallet,
  network: 'mainnet'
});
await driftClient.initialize();

// Open position
await driftClient.openPosition({
  marketIndex: 0, // SOL
  side: 'long',
  amount: new BN(1000000), // in quote (USDC)
  leverage: new BN(5)
});
```

## Key Program IDs (Mainnet)
- Drift Protocol: `dRiftyHA39MWEi3m9aunc5MzRFaJ8RSt3xgN6RxGi8`
- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

---

*Draft: 2026-02-27*
