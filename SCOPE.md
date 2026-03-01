# SolPerps Bot - Project Scope & History

## Project Overview
**Name:** Solana Perpetual Trading Bot  
**Platform:** Telegram Bot + Web Interface  
**Repository:** https://github.com/LithiumEinsteinium/solperps-bot  
**Live URL:** https://solperps-bot.onrender.com  
**Telegram:** @Kilotradingbot

---

## ✅ Working Features

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

---

## 🪐 Jupiter Perps - REAL Trading

### ✅ Working (March 2026)

| Feature | Status | Notes |
|---------|--------|-------|
| `/perp` open | ✅ Working | Opens real positions on Solana |
| `/perppositions` | ✅ Working | Shows positions with PnL, leverage, liquidation |
| Position tracking | ✅ Working | Via Jupiter Portfolio API |
| Size calculation | ✅ Fixed | Using raw amounts (not lamports) |

### ❌ Not Working / Limitations

| Feature | Status | Notes |
|---------|--------|-------|
| `/perpclose` | ❌ Manual | Must close on Jupiter website |
| TP/SL | ❌ Manual | Set on Jupiter website |
| Auto-close | ❌ Not impl | Need to encode decrease position |
| Multiple markets | ⚠️ SOL only | Currently hardcoded for SOL |

---

## 🎉 First Real Position Opened!

- **Date:** March 1, 2026
- **TX:** `4kdHU4HGq6TWfPpS9q1XicuDyFHsfuRNPwEzdefSmrim4DmgrRVCoZ62z8Yne2nDbWP1QgJcEhSURKYDDjZmC6ZM`
- **Position:** SOL LONG ~11x, $100
- **Result:** Successfully shows in `/perppositions` with live PnL!

---

## What We Learned

1. **Request Fulfillment Model** - Jupiter uses keeper model, submits position request, keepers execute
2. **Codama Generated IDL** - Use `npx create-codama-clients` for proper instruction builders
3. **SOL Wrapping** - LONG positions require wrapping SOL to wSOL via SyncNative
4. **Collateral Logic** - LONG = same token, SHORT = USDC
5. **Side Encoding** - `[1]` for long, `[2]` for short (bytes!)
6. **Decimal Issue** - Use raw amounts (not ×1,000,000)

### Verified Addresses
- **Perp Program:** `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`
- **Pool:** `5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq`
- **SOL Custody:** `7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz`
- **Event Authority:** `37hJBDnntwqhGbK7L6M1bLyvccj4u55CCUiLPdYkiqBN`

### Working Transaction Flow
1. SetComputeUnitLimit
2. SetComputeUnitPrice  
3. Wrap SOL + CreateIdempotent (for LONG)
4. CreateIncreasePositionMarketRequest

---

## Commands

### Real Trading (Jupiter Perps)
```
/perp SOL long 10 1   - Open $10, 1x leverage
/perppositions        - View open positions with PnL
/perpclose 0          - Close position (manual for now)
```

### Paper Trading
```
/long SOL 10    - Open paper long
/short SOL 5   - Open paper short  
/close 1       - Close position
/positions     - View positions
```

### Wallet & Info
```
/price           - SOL price
/wallet         - Your bot wallet
/export         - Export private key
/onchain        - Check SOL + USDC balance
/withdraw ADDR  - Withdraw SOL
```

---

## Environment Variables

```
TELEGRAM_BOT_TOKEN=your_bot_token
HELIUS_API_KEY=your_helius_api_key
JUPITER_API_KEY=your_jupiter_api_key  # For position tracking
PAPER_TRADING=true
```

---

## Next Steps

1. Implement close position (encode decrease position request)
2. Add TP/SL support if Jupiter API allows
3. Add more markets (BTC, ETH)
4. Signal bot integration for auto-trading

---

*Last Updated: 2026-03-01*
