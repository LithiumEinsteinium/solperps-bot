# Solana Perps Trading Bot

A comprehensive Solana perpetual trading bot with Jupiter Perps integration.

## Features

1. **Connect to Jupiter Perps** - Open/close positions
2. **Basic Trading** - Long/short SOL or other tokens
3. **TP/SL** - Take profit / stop loss automation
4. **Position Management** - View and manage open positions
5. **Auto-Trading** - Based on signals (MA crossover, RSI, external)
6. **Balance Check** - View wallet balance
7. **Transfers** - Transfer SOL/tokens

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
# Wallet
WALLET_PRIVATE_KEY=[{"...":"..."}]

# RPC
RPC_URL=https://api.mainnet-beta.solana.com

# Telegram (optional)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Bot Settings
PAPER_TRADING=true
AUTO_TRADE=false
POSITION_SIZE=10
LEVERAGE=1
SYMBOL=SOL

# Strategy (ma-cross, rsi, signal)
STRATEGY=ma-cross
AUTO_EXECUTE=false
```

## Usage

```bash
# Start the bot
npm start
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/long SYMBOL SIZE` | Open long position |
| `/short SYMBOL SIZE` | Open short position |
| `/close ID` | Close position |
| `/positions` | View open positions |
| `/balance` | Check balance |
| `/tpsl ID TP SL` | Set TP/SL % |
| `/transfer ADDR AMT` | Transfer funds |
| `/status` | Bot status |
| `/help` | Show help |

## Trading Modes

- **Paper Trading** (`PAPER_TRADING=true`): Simulates all trades, no real money
- **Live Trading**: Executes real trades on Solana

## Deployment

### Render
1. Connect your GitHub repo to Render
2. Set environment variables
3. Deploy as a web service

### Local
```bash
npm start
```

## Project Structure

```
src/
├── index.js              # Main bot entry
├── services/
│   ├── jupiter.js       # Jupiter Perps integration
│   └── positionManager.js # Position tracking
├── strategies/
│   └── signalEngine.js  # Auto-trading strategies
└── handlers/
    └── telegram.js      # Telegram commands
```

## License

MIT
