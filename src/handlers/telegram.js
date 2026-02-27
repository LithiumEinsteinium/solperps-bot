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
  }

  sendHelp(chatId) {
    const help = `
🤖 *SOLPERPS Bot*

*📈 Trading*
/long SOL 10 — Open long
/short SOL 5 — Open short
/close 12345 — Close position

*💵 Price*
/price — SOL price
/price BTC — Any token

*👛 Wallet*
/wallet — Your bot wallet
/export — Export private key
/import KEY — Import wallet
/newwallet — New wallet
/confirmnewwallet — Confirm new wallet

*⛓️ On-Chain*
/deposit — Get deposit address
/onchain — Check on-chain balance
/withdraw ADDRESS AMOUNT — Withdraw SOL

*📊 Perpetuals*
/perp SYM SIDE AMT LEV — Open perp
/perppositions — View positions
/perpclose INDEX — Close position
/perpinfo — Account info
/testnet — Toggle testnet mode
/connect ADDRESS — Phantom

*💼 Management*
/positions — Open positions
/balance — Your balance
/tpsl 12345 10 5 — Set TP/SL

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
    
    try {
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
        const appUrl = 'https://solperps-bot.onrender.com';
        this.sendMessage(chatId, `🔗 *Connect Your Wallet*\n\n*Option 1:* ${appUrl}/connect.html\n\n*Option 2:* Send your address:\n/connect YOUR_ADDRESS\n\nExample: /connect 7xKXtg2CW87d97TXJSDpbD5iBk8RV1fYzVWZ2Mn7dDg`, { parse_mode: 'Markdown' });
      } else if (text.startsWith('/connect ')) {
        const parts = text.split(' ');
        if (parts.length >= 2) {
          const address = parts[1].trim();
          const result = this.bot.phantom?.connect?.(address);
          if (result?.success) {
            this.bot.phantom.address = address;
            this.bot.phantom.connected = true;
            this.sendMessage(chatId, `✅ *Wallet Connected!*\n\nAddress: \`${this.bot.phantom.formatAddress(address)}\`\n\nUse /balance to check your balance.`, { parse_mode: 'Markdown' });
          } else {
            this.sendMessage(chatId, `❌ Could not connect. Please check the address and try again.`);
          }
        }
      } else if (text.startsWith('/mywallet')) {
        const status = this.bot.phantom?.getStatus?.() || { connected: false };
        if (status.connected) {
          this.sendMessage(chatId, `✅ *Wallet Connected!*\n\nAddress: \`${status.publicKey}\`\nBalance: ${status.balance?.toFixed(4) || 0} SOL`, { parse_mode: 'Markdown' });
        } else {
          this.sendMessage(chatId, `❌ No wallet connected.\n\nUse /connect YOUR_ADDRESS to connect.`);
        }
      } else if (text.startsWith('/disconnect')) {
        this.bot.phantom?.disconnect?.();
        this.sendMessage(chatId, '✅ Wallet disconnected.');
      } else if (text.startsWith('/wallet')) {
        try {
          const address = this.bot.userWallets?.getAddress(chatId);
          this.sendMessage(chatId, `👛 *Your Bot Wallet*\n\nAddress: \`${address || 'Error'}\`\n\nUse /export to get your private key.`, { parse_mode: 'Markdown' });
        } catch (e) {
          this.sendMessage(chatId, `❌ Error: ${e.message}`);
        }
      } else if (text.startsWith('/export')) {
        try {
          const privateKey = this.bot.userWallets?.getPrivateKey(chatId);
          const privateKeyArray = JSON.stringify(this.bot.userWallets?.getPrivateKeyArray(chatId));
          const address = this.bot.userWallets?.getAddress(chatId);
          this.sendMessage(chatId, `🔑 *Private Key Export*\n\n⚠️ *WARNING:* Never share this!\n\n*For Phantom/Backpack:*\n\`${privateKey}\`\n\n*For other wallets (JSON):*\n\`${privateKeyArray}\`\n\nAddress: ${address}`, { parse_mode: 'Markdown' });
        } catch (e) {
          this.sendMessage(chatId, `❌ Error: ${e.message}`);
        }
      } else if (text.startsWith('/newwallet')) {
        // Check if they already have a wallet
        const hasExisting = this.bot.userWallets?.hasWallet(chatId);
        
        if (hasExisting) {
          // First time - warn them
          this.sendMessage(chatId, `⚠️ *Warning: Create New Wallet?*\n\nThis will create a NEW wallet and your current wallet will be LOST if you haven't exported the private key.\n\n*To proceed, reply:*\n/confirmnewwallet\n\n*To cancel, just ignore this message.*`, { parse_mode: 'Markdown' });
        } else {
          // No existing wallet - just create one
          try {
            const address = this.bot.userWallets?.getAddress(chatId);
            this.sendMessage(chatId, `👛 *Wallet Created*\n\nAddress: \`${address}\`\n\nUse /export to get your private key!`, { parse_mode: 'Markdown' });
          } catch (e) {
            this.sendMessage(chatId, `❌ Error: ${e.message}`);
          }
        }
      } else if (text.startsWith('/confirmnewwallet')) {
        try {
          // Delete old wallet first to get the address
          const oldAddress = this.bot.userWallets?.hasWallet(chatId) 
            ? this.bot.userWallets?.getAddress(chatId) 
            : null;
          
          this.bot.userWallets?.deleteWallet(chatId);
          const newAddress = this.bot.userWallets?.getAddress(chatId);
          
          this.sendMessage(chatId, `✅ *New Wallet Created*\n\nOld: \`${oldAddress || 'None'}\`\nNew: \`${newAddress}\`\n\n⚠️ *IMPORTANT:* Export your new wallet private key with /export`, { parse_mode: 'Markdown' });
        } catch (e) {
          this.sendMessage(chatId, `❌ Error: ${e.message}`);
        }
      } else if (text.startsWith('/import ')) {
        const parts = text.split(' ');
        const privateKey = parts.slice(1).join(' ').trim();
        
        if (privateKey.length > 20) {
          try {
            const result = this.bot.userWallets?.importWallet(chatId, privateKey);
            if (result?.success) {
              this.sendMessage(chatId, `✅ *Wallet Imported!*\n\nAddress: \`${result.address}\`\n\nYour wallet has been restored.`, { parse_mode: 'Markdown' });
            } else {
              this.sendMessage(chatId, `❌ Import failed: ${result?.error}`);
            }
          } catch (e) {
            this.sendMessage(chatId, `❌ Error: ${e.message}`);
          }
        } else {
          this.sendMessage(chatId, `Usage: /import YOUR_PRIVATE_KEY\n\nPaste your base58 private key to restore your wallet.`);
        }
      } else if (text.startsWith('/deposit')) {
        const address = this.bot.userWallets?.getAddress(chatId);
        this.sendMessage(chatId, `💰 *Deposit SOL*\n\nSend SOL to this address:\n\n\`${address}\`\n\nThen use /onchain to check your balance.`, { parse_mode: 'Markdown' });
      } else if (text.startsWith('/onchain')) {
        try {
          const balance = await this.bot.getOnChainBalance(chatId);
          if (balance.error) {
            this.sendMessage(chatId, `❌ ${balance.error}`);
          } else {
            this.sendMessage(chatId, `⛓️ *On-Chain Balance*\n\nSOL: ${balance.sol?.toFixed(4) || 0}\nUSDC: ${balance.usdc?.toFixed(2) || 0}\n\nUse /deposit to add funds.`, { parse_mode: 'Markdown' });
          }
        } catch (e) {
          this.sendMessage(chatId, `❌ Error: ${e.message}`);
        }
      } else if (text.startsWith('/withdraw ')) {
        const parts = text.split(' ');
        if (parts.length >= 3) {
          const toAddress = parts[1];
          const amount = parseFloat(parts[2]);
          try {
            const result = await this.bot.transferSol(chatId, toAddress, amount);
            if (result.success) {
              this.sendMessage(chatId, `✅ *Withdrawal Complete*\n\nSent ${amount} SOL to \`${toAddress}\`\n\nTx: ${result.txid}`, { parse_mode: 'Markdown' });
            } else {
              this.sendMessage(chatId, `❌ Failed: ${result.error}`);
            }
          } catch (e) {
            this.sendMessage(chatId, `❌ Error: ${e.message}`);
          }
        } else {
          this.sendMessage(chatId, `Usage: /withdraw ADDRESS AMOUNT\n\nExample: /withdraw 7xKXtg2CW87d97TXJSDpbD5iBk8RV1fYzVWZ2Mn7dDg 1`);
        }
      } else if (text.startsWith('/perp ')) {
        // /perp SOL long 10 5 -> symbol, side, amount, leverage
        const parts = text.split(' ');
        if (parts.length >= 5) {
          const symbol = parts[1].toUpperCase();
          const side = parts[2].toLowerCase();
          const amount = parseFloat(parts[3]);
          const leverage = parseFloat(parts[4]);
          
          try {
            this.sendMessage(chatId, `⏳ Opening ${leverage}x ${side} position on ${symbol} with ${amount} USDC...`);
            const result = await this.bot.openPerpPosition(chatId, symbol, side, amount, leverage);
            if (result.success) {
              this.sendMessage(chatId, `✅ *Perp Position Opened*\n\n${symbol}: ${side.toUpperCase()} ${leverage}x\nAmount: ${amount} USDC\n\nTx: \`${result.txid}\``, { parse_mode: 'Markdown' });
            } else {
              this.sendMessage(chatId, `❌ Failed: ${result.error}`);
            }
          } catch (e) {
            this.sendMessage(chatId, `❌ Error: ${e.message}`);
          }
        } else {
          this.sendMessage(chatId, `Usage: /perp SYMBOL SIDE AMOUNT LEVERAGE\n\nExample:\n/perps SOL long 100 5\n/perps BTC short 50 10\n\nMarkets: SOL, BTC, ETH\nMax leverage: 10x`);
        }
      } else if (text.startsWith('/perpclose ')) {
        const parts = text.split(' ');
        const positionIndex = parseInt(parts[1]);
        
        if (!isNaN(positionIndex)) {
          try {
            const result = await this.bot.closePerpPosition(chatId, positionIndex);
            if (result.success) {
              this.sendMessage(chatId, `✅ *Position Closed*\n\nTx: \`${result.txid}\``, { parse_mode: 'Markdown' });
            } else {
              this.sendMessage(chatId, `❌ Failed: ${result.error}`);
            }
          } catch (e) {
            this.sendMessage(chatId, `❌ Error: ${e.message}`);
          }
        } else {
          this.sendMessage(chatId, `Usage: /perpclose POSITION_INDEX\n\nUse /perppositions to see open positions.`);
        }
      } else if (text.startsWith('/perppositions')) {
        try {
          const positions = await this.bot.getPerpPositions(chatId);
          if (positions.length === 0) {
            this.sendMessage(chatId, `📊 No open perp positions`);
          } else {
            let msg = `📊 *Perp Positions*\n\n`;
            positions.forEach((p, i) => {
              msg += `${i}. ${p.market} ${p.side} ${p.leverage}x\n`;
              msg += `   Size: $${p.size.toFixed(2)} | PnL: $${p.pnl.toFixed(2)}\n\n`;
            });
            msg += `Use /perpclose INDEX to close`;
            this.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
          }
        } catch (e) {
          this.sendMessage(chatId, `❌ Error: ${e.message}`);
        }
      } else if (text.startsWith('/perpinfo')) {
        try {
          const info = await this.bot.getPerpAccountInfo(chatId);
          if (info) {
            this.sendMessage(chatId, `⛓️ *Perp Account*\n\nCollateral: $${info.collateral.toFixed(2)}\nHealth: ${info.health.toFixed(2)}%\n\nUse /perp to open positions.`, { parse_mode: 'Markdown' });
          } else {
            this.sendMessage(chatId, `❌ Could not get account info`);
          }
        } catch (e) {
          this.sendMessage(chatId, `❌ Error: ${e.message}`);
        }
      } else if (text === '/testnet' || text.startsWith('/testnet ')) {
        // Toggle testnet mode for this user
        const currentMode = this.bot.userTestnet?.get(chatId.toString()) || false;
        const newMode = !currentMode;
        this.bot.userTestnet?.set(chatId.toString(), newMode);
        
        if (newMode) {
          this.sendMessage(chatId, `🔷 *Testnet Mode ENABLED*\n\nDrift will use testnet. Use /perp to open test positions.\n\nUse /testnet again to switch back to mainnet.`, { parse_mode: 'Markdown' });
        } else {
          this.sendMessage(chatId, `✅ *Mainnet Mode ENABLED*\n\nDrift will use mainnet with real funds.\n\nUse /testnet again to switch to testnet.`, { parse_mode: 'Markdown' });
        }
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
        try {
          const parts = text.split(' ');
          const symbol = parts[1].toUpperCase();
          const price = await this.bot.jupiter.getPrice(symbol);
          this.sendMessage(chatId, `💵 ${symbol}: $${price.toFixed(2)}`);
        } catch (e) {
          this.sendMessage(chatId, `❌ Could not get price. Try: /price SOL`);
        }
      } else if (text.startsWith('/price')) {
        try {
          const price = await this.bot.jupiter.getPrice('SOL');
          this.sendMessage(chatId, `💵 SOL: $${price.toFixed(2)}`);
        } catch (e) {
          this.sendMessage(chatId, `❌ Could not get SOL price`);
        }
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
    } catch (error) {
      console.error('Command error:', error.message);
      if (update.message) {
        this.sendMessage(update.message.chat.id, '❌ Error processing command. Try /help');
      }
    }
  }
}

module.exports = { TelegramHandler };
