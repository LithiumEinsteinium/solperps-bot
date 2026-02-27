# SolPerps Bot - Project Scope & History

## Project Overview
**Name:** Solana Perpetual Trading Bot  
**Platform:** Telegram Bot + Web Interface  
**Repository:** https://github.com/LithiumEinsteinium/solperps-bot  
**Live URL:** https://solperps-bot.onrender.com

---

## Core Features

### ✅ Working Features

| Feature | Status | Notes |
|---------|--------|-------|
| Telegram Commands | Working | All commands responsive |
| `/price` | Working | Uses Binance API (reliable) |
| `/balance` | Working | Shows paper balance (10,000 SOL) |
| `/positions` | Working | Shows open positions |
| `/long` | Working | Opens paper long position |
| `/short` | Working | Opens paper short position |
| `/close` | Working | Closes position by ID |
| `/wallet` | Working | Shows user's bot wallet address |
| `/export` | Working | Exports private key (base58 format for Phantom) |
| `/newwallet` | Working | Creates new wallet (with confirmation) |
| `/confirmnewwallet` | Working | Confirms new wallet creation |
| `/connect` | Working | Connect external Phantom wallet |
| `/mywallet` | Working | Shows connected wallet status |
| `/disconnect` | Working | Disconnects wallet |
| `/status` | Working | Shows bot running status |
| `/help` | Working | Shows help menu |
| `/tpsl` | Working | Sets take profit/stop loss |

### ❌ Removed/Non-Working Features

| Feature | Status | Reason |
|---------|--------|--------|
| `/phantom` | Removed | Phantom deeplink requires App ID |
| On-chain trading | Not implemented | Requires Jupiter Perps API + tx signing |
| Live trading mode | Disabled | Paper trading mode active |

---

## Technical Decisions & Changes

### 1. Wallet Model
**Final Approach:** Built-in wallet per user with private key export  
**How it works:**
- Each user gets their own Solana wallet (generated on first use)
- Private keys stored in `./data/user_wallets.json`
- Users can export private key anytime via `/export`
- Private key in base58 format (Phantom-compatible)
- `/newwallet` requires confirmation to prevent accidental loss

**Why Phantom Deeplink Failed:**
- Phantom's `phantom.app/ul/v1/connect` requires an App ID from Phantom Portal
- Without App ID, the deep link doesn't trigger wallet connection
- Workaround: Users manually enter address via `/connect ADDRESS`

### 2. Private Key Export Format
**Issue:** Default JSON array format not compatible with Phantom  
**Solution:** Export as base58 string (Phantom's expected format)

### 2. Price Feed
**Original:** CoinGecko API (rate limited, sometimes fails)  
**Changed:** Binance API as primary, CoinGecko as backup  
**Reason:** Binance is faster and more reliable for real-time prices

### 3. Paper Trading Default
**Original:** `this.isPaperTrading = config.paperTrading || true`  
**Changed:** `this.isPaperTrading = config.paperTrading === true || config.paperTrading === 'true'`  
**Reason:** Boolean logic bug - `false || true` = `true`, so it always defaulted to paper mode

### 4. Environment Variables
- `.env` removed from GitHub repo (via `.gitignore`)
- Must set `PAPER_TRADING=false` in Render dashboard for live mode

### 5. Telegram Menu
Updated multiple times to reflect current commands:
- Removed `/phantom`
- Removed `/refresh` (broke due to missing method)
- Cleaned up help text

---

## Architecture

```
┌─────────────────┐     Webhook      ┌─────────────────┐
│   Telegram      │ ◄──────────────► │   Node.js Bot   │
│   @Kilotradingbot│                 │   (Render)     │
└─────────────────┘                 └────────┬────────┘
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                      ┌───────────┐  ┌───────────┐  ┌───────────┐
                      │  Jupiter  │  │  Binance  │  │ Phantom   │
                      │  Service  │  │  API      │  │ Wallet    │
                      └───────────┘  └───────────┘  └───────────┘
```

---

## Commands Reference

```
🤖 SOLPERPS Bot

📈 Trading
/long SOL 10 — Open long
/short SOL 5 — Open short
/close 12345 — Close position

💵 Price
/price — SOL price
/price BTC — Any token

👛 Wallet
/connect ADDRESS — Connect
/mywallet — Check status
/disconnect — Disconnect

💼 Management
/positions — Open positions
/balance — Your balance
/tpsl 12345 10 5 — Set TP/SL

ℹ️ Info
/status — Bot status
/help — This message
```

---

## Next Steps (Not Implemented)

1. **On-Chain Trading**
   - Integrate Jupiter Perps API
   - Implement transaction signing via Phantom
   - User approves trades in Phantom app

2. **Web Interface**
   - Connect.html page for easier wallet connection
   - Dashboard for positions and PnL

3. **Auto-Trading**
   - Signal-based trading (MA cross, RSI)
   - Currently disabled (`AUTO_TRADE=false`)

4. **Real Balance**
   - Fetch actual SOL balance from connected wallet
   - Currently shows paper balance

---

## Environment Variables

```
TELEGRAM_BOT_TOKEN=7924758270:AAFws2KXCa4nHvSUAgwdOixeJIuCenEpVN0
TELEGRAM_CHAT_ID=1729150103
APP_URL=https://solperps-bot.onrender.com
PAPER_TRADING=false
AUTO_TRADE=false
```

---

## Files

| File | Purpose |
|------|---------|
| `src/index.js` | Main bot logic |
| `src/handlers/telegram.js` | Telegram command handlers |
| `src/services/jupiter.js` | Price fetching, position management |
| `src/services/phantomWallet.js` | Wallet connection management |
| `src/services/positionManager.js` | Position tracking |
| `src/strategies/signalEngine.js` | Trading signals |
| `public/connect.html` | Web wallet connection page |

---

## Lessons Learned

1. **Phantom Deep Links require App ID** - Can't use without registering
2. **Boolean defaults** - Be careful with `|| true` patterns
3. **Price APIs** - Binance more reliable than CoinGecko
4. **Error handling** - Telegram bots crash silently without try/catch
5. **Environment variables** - Not automatically deployed to hosting

---

*Last Updated: 2026-02-26*
