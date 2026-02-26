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
      
      // Try polling, but don't crash if it fails
      try {
        this.telegram.on('polling_error', (error) => {
          console.log('Polling error:', error.message);
        });
      } catch (e) {
        // Ignore polling setup errors
      }
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
🤖 *SOLPERPS Bot*

*📈 Trading*
/long SOL 10 — Open long 10 SOL
/short SOL 5 — Open short 5 SOL
/close 12345 — Close position

*💵 Prices*
/price — SOL price
/price BTC — Any token price

*👛 Phantom Wallet*
/phantom — Connect your Phantom
/mywallet — Check Phantom status
/disconnect — Disconnect wallet

*💼 Management*
/positions — Open positions
/balance — Your balance
/wallet — Bot wallet address
/tpsl 12345 10 5 — 10% TP, 5% SL

*ℹ️ Info*
/status — Bot status
/help — This message
`;
    this.sendMessage(chatId, help, { parse_mode: 'Markdown' });
  }

  formatTradeResult(result) {
    if (result.success) {
      const p = result.position;
      const entry = p.entryPrice ? `$${p.entryPrice.toFixed(2)}` : 'N/A';
      return `✅ Position Opened!
${p.side.toUpperCase()} ${p.size} ${p.symbol}
Entry: ${entry}
Mode: ${result.mode.toUpperCase()}`;
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

  // Handle incoming webhook updates
  async handleUpdate(update) {
    if (!this.telegram) return;
    
    if (update.message) {
      const msg = update.message;
      const text = msg.text || '';
      const chatId = msg.chat.id;
      
      // Simple command routing
      if (text.startsWith('/help') || text.startsWith('/start')) {
        this.sendHelp(chatId);
      } else if (text.startsWith('/balance')) {
        const balance = await this.bot.getBalance();
        this.sendMessage(chatId, `💰 Balance:\nSOL: ${balance.sol.toFixed(4)}\nUSD: $${balance.usd.toFixed(2)}`);
      } else if (text.startsWith('/positions')) {
        const positions = await this.bot.getPositions();
        if (positions.length === 0) {
          this.sendMessage(chatId, '📊 No open positions');
        } else {
          let msgText = '📊 Open Positions:\n\n';
          positions.forEach(p => {
            msgText += `${p.side.toUpperCase()} ${p.size} ${p.symbol} @ $${p.entryPrice.toFixed(2)}\nID: ${p.id}\n\n`;
          });
          this.sendMessage(chatId, msgText);
        }
      } else if (text.startsWith('/status')) {
        const status = this.bot.isRunning ? '🟢 Running' : '🔴 Stopped';
        const mode = this.bot.isPaperTrading ? '📝 Paper' : '💸 Live';
        this.sendMessage(chatId, `Status: ${status}\nMode: ${mode}`);
      } else if (text.startsWith('/wallet')) {
        const wallet = this.bot.getWalletAddress();
        this.sendMessage(chatId, `👛 Bot Wallet:\n\`${wallet}\``, { parse_mode: 'Markdown' });
      } else if (text.startsWith('/phantom') || text.startsWith('/connect')) {
        this.sendMessage(chatId, `🔗 *Connect Your Phantom Wallet*\n\n*Option 1: Deep Link*\nOpen in Phantom app: https://phantom.app/ul/v1/connect\n\n*Option 2: Manual Entry*\nUse: /connect [YOUR_SOLANA_ADDRESS]\n\nExample: /connect 7xKXtg2CW87d97TXJSDpbD5iBk8RV1fYzVWZ2Mn7dDg\n\n*Note:* Your trades will be signed by your wallet.`, { parse_mode: 'Markdown' });
      } else if (text.startsWith('/connect ')) {
        const parts = text.split(' ');
        if (parts.length >= 2) {
          const address = parts[1].trim();
          const result = this.bot.phantom?.connect?.(address);
          if (result?.success) {
            this.sendMessage(chatId, `✅ *Wallet Connected!*\n\nAddress: \`${this.bot.phantom.formatAddress(address)}\`\n\nUse /mywallet to check balance.`, { parse_mode: 'Markdown' });
          } else {
            this.sendMessage(chatId, `❌ Invalid address. Please enter a valid Solana address.`);
          }
        } else {
          this.sendMessage(chatId, `Usage: /connect [SOLANA_ADDRESS]\n\nExample: /connect 7xKXtg2CW87d97TXJSDpbD5iBk8RV1fYzVWZ2Mn7dDg`);
        }
      } else if (text.startsWith('/mywallet')) {
        const status = this.bot.phantom?.getStatus?.() || { connected: false };
        if (status.connected) {
          this.sendMessage(chatId, `✅ *Phantom Connected!*\n\nAddress: \`${status.publicKey}\`\nBalance: ${status.balance?.toFixed(4) || 0} SOL`, { parse_mode: 'Markdown' });
        } else {
          this.sendMessage(chatId, `❌ No Phantom connected.\n\nUse /phantom to connect your wallet.`);
        }
      } else if (text.startsWith('/disconnect')) {
        this.bot.phantom?.disconnect?.();
        this.sendMessage(chatId, '✅ Wallet disconnected.');
      } else if (text.startsWith('/long ')) {
        const parts = text.split(' ');
        if (parts.length >= 3) {
          const symbol = parts[1].toUpperCase();
          const size = parseFloat(parts[2]);
          const result = await this.bot.openPosition({ symbol, side: 'long', size });
          this.sendMessage(chatId, this.formatTradeResult(result));
        } else {
          this.sendMessage(chatId, 'Usage: /long SYMBOL SIZE\nExample: /long SOL 10');
        }
      } else if (text.startsWith('/short ')) {
        const parts = text.split(' ');
        if (parts.length >= 3) {
          const symbol = parts[1].toUpperCase();
          const size = parseFloat(parts[2]);
          const result = await this.bot.openPosition({ symbol, side: 'short', size });
          this.sendMessage(chatId, this.formatTradeResult(result));
        } else {
          this.sendMessage(chatId, 'Usage: /short SYMBOL SIZE\nExample: /short SOL 5');
        }
      } else if (text.startsWith('/close ')) {
        const parts = text.split(' ');
        if (parts.length >= 2) {
          const positionId = parts[1];
          const result = await this.bot.closePosition(positionId);
          this.sendMessage(chatId, this.formatCloseResult(result));
        } else {
          this.sendMessage(chatId, 'Usage: /close POSITION_ID');
        }
      } else if (text.startsWith('/price ')) {
        const parts = text.split(' ');
        if (parts.length >= 2) {
          const symbol = parts[1].toUpperCase();
          const price = await this.bot.getLivePrice(symbol);
          this.sendMessage(chatId, `💵 ${symbol} Price: $${price.toFixed(2)}`);
        } else {
          this.sendMessage(chatId, 'Usage: /price SYMBOL\nExample: /price SOL');
        }
      } else if (text.startsWith('/price')) {
        const price = await this.bot.getLivePrice('SOL');
        this.sendMessage(chatId, `💵 SOL Price: $${price.toFixed(2)}`);
      } else if (text.startsWith('/refresh ')) {
        const parts = text.split(' ');
        if (parts.length >= 2) {
          const symbol = parts[1].toUpperCase();
          const price = await this.bot.jupiter.getFreshPrice(symbol);
          this.sendMessage(chatId, `🔄 ${symbol} Price (refreshed): $${price.toFixed(2)}`);
        } else {
          const price = await this.bot.jupiter.getFreshPrice('SOL');
          this.sendMessage(chatId, `🔄 SOL Price (refreshed): $${price.toFixed(2)}`);
        }
      } else if (text.startsWith('/refresh')) {
        const price = await this.bot.jupiter.getFreshPrice('SOL');
        this.sendMessage(chatId, `🔄 SOL Price (refreshed): $${price.toFixed(2)}`);
      } else if (text.startsWith('/alert ')) {
        const parts = text.split(' ');
        if (parts.length >= 4) {
          const symbol = parts[1].toUpperCase();
          const direction = parts[2].toLowerCase();
          const targetPrice = parseFloat(parts[3]);
          
          if (!['above', 'below'].includes(direction)) {
            this.sendMessage(chatId, 'Usage: /alert SYMBOL ABOVE/BELOW PRICE\nExample: /alert SOL above 100');
            return;
          }
          
          const result = this.bot.setPriceAlert(symbol, targetPrice, direction, chatId);
          this.sendMessage(chatId, `🔔 Price Alert Set!\n${symbol} ${direction} $${targetPrice}\nAlert ID: ${result.alertId}`);
        } else {
          this.sendMessage(chatId, 'Usage: /alert SYMBOL ABOVE/BELOW PRICE\nExample: /alert SOL above 100');
        }
      } else if (text.startsWith('/alerts')) {
        const alerts = this.bot.getPriceAlerts();
        if (alerts.length === 0) {
          this.sendMessage(chatId, '🔔 No active price alerts');
        } else {
          let msg = '🔔 Active Price Alerts:\n\n';
          alerts.forEach(a => {
            msg += `ID: ${a.id}\n${a.symbol} ${a.direction} $${a.targetPrice}\n\n`;
          });
          this.sendMessage(chatId, msg);
        }
      } else if (text.startsWith('/clearalert ') || text.startsWith('/clear ')) {
        const parts = text.split(' ');
        if (parts.length >= 2) {
          const alertId = parts[1];
          const result = this.bot.removePriceAlert(alertId);
          if (result.success) {
            this.sendMessage(chatId, `✅ Alert removed`);
          } else {
            this.sendMessage(chatId, `❌ ${result.error}`);
          }
        } else {
          this.sendMessage(chatId, 'Usage: /clearalert ALERT_ID');
        }
      } else if (text.startsWith('/clear')) {
        const alerts = this.bot.getPriceAlerts();
        if (alerts.length === 0) {
          this.sendMessage(chatId, '🔔 No alerts to clear');
        } else {
          let msg = 'Use /clearalert ID to remove:\n\n';
          alerts.forEach(a => {
            msg += `/clearalert ${a.id} — ${a.symbol} ${a.direction} $${a.targetPrice}\n`;
          });
          this.sendMessage(chatId, msg);
        }
      }
    }
  }
}

module.exports = { TelegramHandler };
