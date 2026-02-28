# SolPerps Bot - Project Scope & History

## Project Overview
**Name:** Solana Perpetual Trading Bot  
**Platform:** Telegram Bot + Web Interface  
**Repository:** https://github.com/LithiumEinsteinium/solperps-bot  
**Live URL:** https://solperps-bot.onrender.com  
**Telegram:** @Kilotradingbot

---

## Core Features

### ✅ Working Features

| Feature | Status | Notes |
|---------|--------|-------|
| `/price` | ✅ Working | Uses Binance API |
| `/balance` | ✅ Working | Paper balance (10,000 SOL) |
| `/positions` | ✅ Working | Shows open positions |
| `/long` | ✅ Working | Opens paper long |
| `/short` | ✅ Working | Opens paper short |
| `/close` | ✅ Working | Closes position |
| `/wallet` | ✅ Working | Shows bot wallet address |
| `/export` | ✅ Working | Exports private key (Phantom-compatible) |
| `/import` | ✅ Working | Imports wallet from private key |
| `/deposit` | ✅ Working | Get deposit address |
| `/onchain` | ✅ Working | Shows SOL + USDC balance |
| `/withdraw` | ✅ Working | Withdraw SOL to external address |
| `/perp` | ✅ Working | Paper trading |
| `/perppositions` | ✅ Working | Paper positions |

### 🔄 In Progress - Jupiter Perps

| Feature | Status | Notes |
|---------|--------|-------|
| `/perp` (real) | 🔄 In Progress | Encoder complete, needs testing |
| Jupiter API | 🔄 In Progress | Using keeper model with verified addresses |

---

## Jupiter Perps Integration

### Status: Close to Working! 🎯

We've built a complete Jupiter Perps encoder with:

1. **Verified Addresses** (from official Jupiter docs):
   - Pool: `5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq`
   - Custodies: SOL, ETH, BTC, USDC, USDT
   - Oracles: Edge/Chaos Labs (primary)

2. **Keeper Model**:
   - Creates PositionRequest first
   - Keeper fills the position
   - Uses `instantIncreasePosition` instruction

3. **Instruction Encoding**:
   - 8-byte discriminators (SHA256 hashes)
   - 18 accounts in correct order
   - Borsh encoding for u64, Options, enums

### Addresses Verified From Official Sources
- Dev docs: https://dev.jup.ag/docs/perps
- Support: https://support.jup.ag

---

## Technical Decisions & Changes

### 1. Wallet Model
**Final Approach:** Built-in wallet per user with private key export
- Each user gets their own Solana wallet
- Private keys stored in `./data/user_wallets.json`
- Users can export private key via `/export` (base58 format for Phantom)
- Users can import existing wallet via `/import`
- `/newwallet` requires confirmation to prevent accidental loss

### 2. Price Feed
- Primary: Binance API (fast, reliable)
- Fallback: CoinGecko

### 3. On-Chain Trading
- Uses Jupiter API for swaps/transfers
- Users deposit SOL to bot wallet address
- Can withdraw SOL to any address

### 4. Perpetuals (Drift)
- **Status:** SDK had compatibility issues
- Users can still use their wallet on Drift UI

---

## Commands Reference

```
📈 Trading (Paper)
/long SOL 10 — Open long
/short SOL 5 — Open short
/close 12345 — Close position

💵 Price
/price — SOL price
/price BTC — Any token

👛 Wallet
/wallet — Your bot wallet
/export — Export private key
/import KEY — Import wallet
/deposit — Get deposit address

⛓️ On-Chain
/onchain — Check balance
/withdraw ADDR AMT — Withdraw SOL

📊 Perpetuals (Beta)
/perp SOL long 10 5 — Open 5x long (paper)
/perppositions — View positions
/perpclose INDEX — Close position
/perpsinfo — Account info

ℹ️ Info
/status — Bot status
/help — This message
```

---

## Architecture

```
┌─────────────────┐     Webhook      ┌─────────────────┐
│   Telegram      │ ◄──────────────► │   Node.js Bot   │
│   @Kilotradingbot│                 │   (Render)     │
└─────────────────┘                 └────────┬────────┘
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                       ┌──────────┐   ┌──────────┐    ┌──────────┐
                       │  Binance │   │ Jupiter  │    │  Drift   │
                       │  Price   │   │  Perps   │    │  Perps   │
                       │  API     │   │ (Coming) │    │ (SDK)    │
                       └──────────┘   └──────────┘    └──────────┘
```

---

## Known Issues

1. **Drift SDK** - Node 25 compatibility issues with rpc-websockets
2. **Wallet persistence** - Wallets stored in server file system, lost on redeploy
   - Use `/import` to restore from exported private key

---

## Environment Variables

```
TELEGRAM_BOT_TOKEN=7924758270:AAFws2KXCa4nHvSUAgwdOixeJIuCenEpVN0
TELEGRAM_CHAT_ID=1729150103
PAPER_TRADING=true
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/index.js` | Main bot logic |
| `src/handlers/telegram.js` | Telegram command handlers |
| `src/services/jupiter.js` | Price fetching, position management |
| `src/services/userWallet.js` | Wallet per user management |
| `src/services/onChainTrader.js` | On-chain trades (deposit/withdraw) |
| `src/services/jupiterPerps.js` | Jupiter perp trading (v10) |
| `src/services/jupiterPerpsEncoder.js` | Instruction encoder |

---

## Lessons Learned

1. **Phantom private key format** - Uses 42-char base58, requires `fromSeed()` not `fromSecretKey()`
2. **Boolean defaults** - Be careful with `|| true` patterns
3. **Price APIs** - Binance > CoinGecko for real-time
4. **Env vars** - Not auto-deployed to hosting
5. **Error handling** - Telegram bots crash silently without try/catch
6. **bs58 v6** - Use `.default` when requiring
7. **Node versions** - Drift SDK needs Node 20, not 25
8. **Jupiter Perps** - Uses keeper model, needs verified addresses from official docs

---

## Next Steps

1. ✅ Test Jupiter Perps with verified addresses
2. Add perp position monitoring
3. Add TP/SL for perp positions
4. Add auto-trading signals
5. Add portfolio view

---

*Last Updated: 2026-02-27*
