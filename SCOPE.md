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
| `/perp` | ✅ WORKING | **REAL Jupiter Perps positions!** 🎉 |

---

##UPITER PERPS - NOW WORKING!

 🎉 J**First real position opened:** March 1, 2026
- **TX:** `4kdHU4HGq6TWfPpS9q1XicuDyFHsfuRNPwEzdefSmrim4DmgrRVCoZ62z8Yne2nDbWP1QgJcEhSURKYDDjZmC6ZM`
- **Position:** SOL LONG 5x, $10

### What We Learned

1. **Request Fulfillment Model** - Jupiter Perps uses a keeper model where you submit a position request and keepers execute it
2. **Codama Generated IDL** - Use `npx create-codama-clients` to generate proper instruction builders from IDL
3. **Correct Discriminators** - Get from Codama-generated code, not hand-rolled
4. **SOL Wrapping** - For LONG positions, must wrap SOL to wSOL using SyncNative
5. **Collateral Logic** - LONG uses same token as collateral, SHORT uses USDC
6. **Side Encoding** - `[1]` for long, `[2]` for short (bytes, not strings!)

### Verified Addresses (From Codama + Community Repo)
- **Perp Program:** `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`
- **Pool:** `5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq`
- **SOL Custody:** `7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz`
- **USDC Custody:** `G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa`
- **Event Authority:** `37hJBDnntwqhGbK7L6M1bLyvccj4u55CCUiLPdYkiqBN`
- **Pool SOL Vault:** `BUvduFTd2sWFagCunBPLupG8fBTJqweLw9DuhruNFSCm`
- **Pool USDC Vault:** `WzWUoCmtVv7eqAbU3BfKPU3fhLP6CXR8NCJH78UK9VS`

### Correct Discriminators (From Codama)
- `createIncreasePositionMarketRequest`: `[184, 85, 199, 24, 105, 171, 156, 56]`
- `setTokenLedger`: `[228, 85, 185, 112 79, 77, 2, 78,]`
- `increasePositionPreSwap`: `[26, 136, 225, 217, 22, 21, 83, 20]`
- `instantIncreasePosition`: `[164, 126, 68, 182, 223, 166, 64, 183]`

### Working Transaction Flow (4 steps)
1. SetComputeUnitLimit
2. SetComputeUnitPrice  
3. Wrap SOL to wSOL (transfer + SyncNative) + CreateIdempotent
4. CreateIncreasePositionMarketRequest

### Key Resources
- **Community Repo:** https://github.com/julianfssen/jupiter-perps-anchor-idl-parsing
- **Jupiter Docs:** https://dev.jup.ag/docs/perps
- **Event Authority:** `37hJBDnntwqhGbK7L6M1bLyvccj4u55CCUiLPdYkiqBN`

---

## Environment Variables
```
TELEGRAM_BOT_TOKEN=7924758270:AAFws2KXCa4nHvSUAgwdOixeJIuCenEpVN0
HELIUS_API_KEY=d3bae4a8-b9a7-4ce2-9069-6224be9cd33c
```

---

## Skills Created
1. **solana-dev** - General Solana development
2. **integrating-jupiter** - Jupiter API integration  
3. **solana-anchor-claude-skill** - Anchor program development

---

*Last Updated: 2026-03-01*
| `/perppositions` | ✅ Working | Paper positions |

### 🔄 In Progress - Jupiter Perps

| Feature | Status | Notes |
|---------|--------|-------|
| `/perp` (real) | 🔄 Close! | Encoder complete, testing |
| Jupiter API | 🔄 Testing | Using keeper model |

---

## Jupiter Perps Integration - Latest Updates

### Recent Fixes (Feb 2026)

1. **USDC Address Fixed**
   - Correct address: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
   - Previously used wrong address causing $0 balance
   - Fixed in: `onChainTrader.js` and `jupiterPerpsEncoder.js`

2. **Instruction Account Order Fixed**
   - Error: `AccountOwnedByWrongProgram`
   - Fix: `fundingAccount` now correctly uses user's token account

3. **Multiple RPCs Added**
   - Added fallback RPCs: Ankr, PublicNode
   - Prevents rate limiting issues

### Verified Addresses (From Official Jupiter Docs)
- Pool: `5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq`
- Custodies: SOL, ETH, BTC, USDC, USDT
- Oracles: Edge/Chaos Labs (primary)

**Sources:**
- Dev docs: https://dev.jup.ag/docs/perps
- Support: https://support.jup.ag

### Keeper Model
- Creates PositionRequest first
- Keeper fills the position
- Uses `CreateIncreasePositionMarketRequest` instruction

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
                       │  API     │   │(Testing) │    │ (SDK)    │
                       └──────────┘   └──────────┘    └──────────┘
```

---

## Known Issues

1. **Drift SDK** - Node 25 compatibility issues with rpc-websockets
2. **Wallet persistence** - Wallets stored in server file system, lost on redeploy
   - Use `/import` to restore from exported private key
3. **Jupiter Perps** - Still testing, close to working!

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
2. **USDC Address** - Real USDC is `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
3. **Price APIs** - Binance > CoinGecko for real-time
4. **Error handling** - Telegram bots crash silently without try/catch
5. **bs58 v6** - Use `.default` when requiring
6. **Jupiter Perps** - Uses keeper model, needs verified addresses from official docs

---

## Next Steps

1. ✅ Test Jupiter Perps with verified addresses
2. Add perp position monitoring
3. Add TP/SL for perp positions
4. Add auto-trading signals
5. Add portfolio view

---

*Last Updated: 2026-02-27*
