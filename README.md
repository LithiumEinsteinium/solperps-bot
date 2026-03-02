# Solana Perps Trading Bot

A Telegram bot for perpetual trading on Solana with **Jupiter Perps** integration.

## 🎉 What's Working

- **Real Jupiter Perps positions** - Open SOL long/short on mainnet!
- **Position tracking** - View open positions with PnL, leverage, liquidation price
- Telegram bot interface
- Paper trading mode
- Wallet management (create, import, export)
- Balance checking (SOL + USDC)
- Deposits and withdrawals

## Commands

### Real Trading (Jupiter Perps)
```
/perp SOL long 10 1   - Open $10, 1x leverage (LONG)
/perp SOL short 10 1  - Open $10, 1x leverage (SHORT)
/perppositions        - View open positions with PnL
/perpclose 0         - Close position by index
/perpsinfo           - Account info
```

### Paper Trading
```
/long SOL 10    - Open paper long
/short SOL 5   - Open paper short  
/close 1       - Close position
/positions     - View all positions
```

### Price & Wallet
```
/price           - SOL price
/price BTC      - Any token price
/wallet         - Your bot wallet address
/export         - Export private key (Phantom-compatible)
/import KEY     - Import wallet
/deposit        - Get deposit address
/onchain        - Check SOL + USDC balance
/withdraw ADDR AMT - Withdraw SOL
```

### Info
```
/status    - Bot status
/help      - Show help
```

## Setup

### Environment Variables

```env
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
HELIUS_API_KEY=your_helius_api_key

# Optional
JUPITER_API_KEY=your_jupiter_api_key  # For position tracking
PAPER_TRADING=true
```

### Get API Keys

1. **Helius** (RPC): https://helius.xyz
2. **Jupiter** (positions): https://portal.jup.ag (free)

## What's Working (March 2026)

- ✅ **Open positions** - `/perp SOL long 10 1`
- ✅ **Close positions** - `/perpclose 1`
- ✅ **View positions** - `/perppositions` with PnL, leverage, liquidation
- ✅ **Position tracking** - Via Jupiter Portfolio API
- ✅ **Wallet management** - Create, import, export (Phantom-compatible)

## Limitations

- **TP/SL**: Must set manually on Jupiter website (instant version requires keeper signatures)
- **Markets**: Currently SOL only
- **Close position**: Use index from `/perppositions` (e.g., `/perpclose 1`)

## Automation

This bot can be integrated with your trading signals:
- Entry: `/perp SOL long 10 1`
- Exit: `/perpclose 1`

See SCOPE.md for technical details.

## How It Works

1. Bot creates a wallet for each user
2. User deposits SOL/USDC to their bot wallet
3. Use `/perp` commands to open real positions on Jupiter Perps
4. Keepers execute the positions on-chain
5. Use `/perppositions` to track PnL

## Architecture

```
Telegram Bot → Node.js → Jupiter Perps (Solana Mainnet)
                     → Helius RPC
                     → Jupiter API (portfolio/positions)
```

## Files

| File | Purpose |
|------|---------|
| `src/index.js` | Main bot |
| `src/handlers/telegram.js` | Telegram commands |
| `src/services/jupiterPerps.js` | Jupiter Perps integration |
| `src/services/jupiterPerpsEncoder.js` | Transaction encoder |

## Deployment

Deploy to Render.com:
```bash
# Push to GitHub, connect to Render
# Set environment variables
# Deploy!
```

## License

MIT
