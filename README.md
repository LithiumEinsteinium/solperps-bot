# Solana Perps Trading Bot

A comprehensive Solana perpetual trading bot with **Jupiter Perps** integration.

## 🎉 What's Working

- **Real Jupiter Perps positions** - Open SOL long/short on mainnet!
- Telegram bot interface
- Paper trading mode
- Wallet management (create, import, export)
- Balance checking (SOL + USDC)
- Deposits and withdrawals

## Commands

### Trading (Real - Jupiter Perps)
```
/perp SOL long 10 5   - Open 10 USDC, 5x leverage (LONG)
/perp SOL short 10 5  - Open 10 USDC, 5x leverage (SHORT)
/perppositions        - View open Jupiter positions
/perpsinfo            - Account info
```

### Trading (Paper)
```
/long SOL 10    - Open paper long
/short SOL 5   - Open paper short  
/close 1       - Close position by index
/positions     - View open positions
```

### Price & Wallet
```
/price           - SOL price
/price BTC      - Any token price
/wallet         - Your bot wallet address
/export         - Export private key
/import KEY     - Import wallet
/deposit        - Get deposit address
/onchain        - Check SOL + USDC balance
/withdraw ADDR AMT - Withdraw SOL
```

### Info
```
/status    - Bot status
/help      - Show this help
```

## Setup

### Environment Variables

```env
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
HELIUS_API_KEY=your_helius_api_key

# Optional (defaults provided)
JUPITER_API_KEY=your_jupiter_api_key  # For position tracking
PAPER_TRADING=true
```

### Get API Keys

1. **Helius** (RPC): https://helius.xyz
2. **Jupiter** (positions): https://portal.jup.ag

## How It Works

1. Bot creates a wallet for each user
2. User deposits SOL/USDC to their bot wallet
3. Use `/perp` commands to open real positions on Jupiter Perps
4. Keepers execute the positions on-chain

## Architecture

```
Telegram Bot → Node.js → Jupiter Perps (Solana Mainnet)
                     → Helius RPC
                     → Jupiter API (portfolio)
```

## Files

| File | Purpose |
|------|---------|
| `src/index.js` | Main bot |
| `src/handlers/telegram.js` | Telegram commands |
| `src/services/jupiterPerps.js` | Jupiter Perps integration |
| `src/services/jupiterPerpsEncoder.js` | Transaction encoder |
| `src/services/onChainTrader.js` | On-chain trades |

## Deployment

Deploy to Render.com:
```bash
# Push to GitHub, connect to Render
# Set environment variables
# Deploy!
```

## License

MIT
