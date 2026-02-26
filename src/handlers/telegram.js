const TelegramBot = require('node-telegram-bot-api');

class TelegramHandler {
  constructor(bot, config = {}) {
    this.bot = bot;
    this.config = config;
    this.chatId = config.chatId;
    
    if (config.token) {
      this.initBot(config.token);
    }
  }

  initBot(token) {
    try {
      this.telegram = new TelegramBot(token, { polling: false });
      console.log('✅ Telegram bot initialized');
      this.setupCommands();
    } catch (error) {
      console.log('⚠️ Telegram bot not available:', error.message);
    }
  }

  setupCommands() {
    if (!this.telegram) return;

    // Help command
    this.telegram.onText(/\/help/, (msg) => {
      this.sendHelp(msg.chat.id);
    });

    // Balance command
    this.telegram.onText(/\/balance/, async (msg) => {
      const balance = await this.bot.getBalance();
      this.sendMessage(msg.chat.id, `💰 Balance:\nSOL: ${balance.sol.toFixed(4)}\nUSD: $${balance.usd.toFixed(2)}`);
    });

    // Positions command
    this.telegram.onText(/\/positions/, async (msg) => {
      const positions = await this.bot.getPositions();
      if (positions.length === 0) {
        this.sendMessage(msg.chat.id, '📊 No open positions');
      } else {
        let text = '📊 Open Positions:\n\n';
        positions.forEach(p => {
          text += `${p.side.toUpperCase()} ${p.size} ${p.symbol} @ $${p.entryPrice.toFixed(2)}\n`;
        });
        this.sendMessage(msg.chat.id, text);
      }
    });

    // Open position
    this.telegram.onText(/\/long\s+(\w+)\s+(\d+)/, async (msg, match) => {
      const symbol = match[1].toUpperCase();
      const size = parseFloat(match[2]);
      const result = await this.bot.openPosition({ symbol, side: 'long', size });
      this.sendMessage(msg.chat.id, this.formatTradeResult(result));
    });

    this.telegram.onText(/\/short\s+(\w+)\s+(\d+)/, async (msg, match) => {
      const symbol = match[1].toUpperCase();
      const size = parseFloat(match[2]);
      const result = await this.bot.openPosition({ symbol, side: 'short', size });
      this.sendMessage(msg.chat.id, this.formatTradeResult(result));
    });

    // Close position
    this.telegram.onText(/\/close\s+(\d+)/, async (msg, match) => {
      const positionId = match[1];
      const result = await this.bot.closePosition(positionId);
      this.sendMessage(msg.chat.id, this.formatCloseResult(result));
    });

    // TP/SL
    this.telegram.onText(/\/tpsl\s+(\d+)\s+(\d+)\s+(\d+)/, async (msg, match) => {
      const positionId = match[1];
      const tp = parseFloat(match[2]);
      const sl = parseFloat(match[3]);
      const result = this.bot.setTpSl(positionId, tp, sl);
      this.sendMessage(msg.chat.id, `✅ TP/SL set: TP ${tp}%, SL ${sl}%`);
    });

    // Transfer
    this.telegram.onText(/\/transfer\s+(\w+)\s+([\d.]+)/, async (msg, match) => {
      const address = match[1];
      const amount = parseFloat(match[2]);
      const result = await this.bot.transfer(address, amount);
      this.sendMessage(msg.chat.id, this.formatTransferResult(result));
    });

    // Status
    this.telegram.onText(/\/status/, (msg) => {
      const status = this.bot.isRunning ? '🟢 Running' : '🔴 Stopped';
      const mode = this.bot.isPaperTrading ? '📝 Paper' : '💸 Live';
      this.sendMessage(msg.chat.id, `Status: ${status}\nMode: ${mode}`);
    });

    // Wallet
    this.telegram.onText(/\/wallet/, (msg) => {
      const wallet = this.bot.getWalletAddress();
      this.sendMessage(msg.chat.id, `👛 Wallet Address:\n\`${wallet}\``, { parse_mode: 'Markdown' });
    });
  }

  sendHelp(chatId) {
    const help = `
🤖 *SOLPERPS Bot Commands*

*Trading*
/long SYMBOL SIZE - Open long position
/short SYMBOL SIZE - Open short position
/close ID - Close position by ID

*Management*
/positions - View open positions
/balance - Check balance
/wallet - Get wallet address
/tpsl ID TP SL - Set take profit & stop loss %
/transfer ADDRESS AMOUNT - Transfer funds

*Info*
/status - Bot status
/help - Show this help

*Examples*
/long SOL 10 - Long 10 SOL
/short BTC 0.5 - Short 0.5 BTC
/tpsl 12345 10 5 - Set 10% TP, 5% SL
`;
    this.sendMessage(chatId, help, { parse_mode: 'Markdown' });
  }

  formatTradeResult(result) {
    if (result.success) {
      return `✅ Position opened!\n${result.mode.toUpperCase()} TRADING\n${result.position.side.toUpperCase()} ${result.position.size} ${result.position.symbol}`;
    }
    return `❌ Failed: ${result.error}`;
  }

  formatCloseResult(result) {
    if (result.success) {
      return `✅ Position closed!\nPnL: $${result.pnl?.toFixed(2) || 'N/A'}`;
    }
    return `❌ Failed: ${result.error}`;
  }

  formatTransferResult(result) {
    if (result.success) {
      return `✅ Transfer complete!\nTx: ${result.txId}`;
    }
    return `❌ Failed: ${result.error}`;
  }

  async send(message) {
    if (this.telegram && this.chatId) {
      try {
        await this.telegram.sendMessage(this.chatId, message);
      } catch (error) {
        console.error('Telegram send error:', error.message);
      }
    }
  }

  async sendMessage(chatId, message, options = {}) {
    if (this.telegram) {
      try {
        await this.telegram.sendMessage(chatId, message, options);
      } catch (error) {
        console.error('Telegram send error:', error.message);
      }
    }
  }
}

module.exports = { TelegramHandler };
