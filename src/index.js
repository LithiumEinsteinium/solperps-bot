require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { JupiterService } = require('./services/jupiter');
const { PositionManager } = require('./services/positionManager');
const { SignalEngine } = require('./strategies/signalEngine');
const { TelegramHandler } = require('./handlers/telegram');
const { PhantomWalletManager } = require('./services/phantomWallet');

const PORT = process.env.PORT || 3000;

// Store bot instance globally for webhook access
let botInstance = null;

// Create HTTP server to handle Telegram webhooks
const server = http.createServer(async (req, res) => {
  // Handle webhook
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const update = JSON.parse(body);
        if (botInstance && botInstance.telegram && botInstance.telegram.handleUpdate) {
          await botInstance.telegram.handleUpdate(update);
        }
      } catch (e) {
        console.error('Webhook error:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SOLPERPS Bot is running!\n');
  }
});

server.listen(PORT, () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
});

function generateWallet() {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toString(),
    secretKey: Array.from(keypair.secretKey)
  };
}

function loadOrCreateWallet() {
  const walletPath = './data/wallet.json';
  
  if (fs.existsSync(walletPath)) {
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const secretKey = new Uint8Array(walletData.secretKey);
    return Keypair.fromSecretKey(secretKey);
  }
  
  // Generate new wallet
  const wallet = generateWallet();
  
  // Ensure directory exists
  const dir = path.dirname(walletPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Save wallet
  fs.writeFileSync(walletPath, JSON.stringify(wallet, null, 2));
  console.log(`🔐 New wallet generated: ${wallet.publicKey}`);
  console.log(`📁 Wallet saved to: ${walletPath}`);
  console.log(`⚠️ IMPORTANT: Backup this file! It's the only way to access your funds.`);
  
  return Keypair.fromSecretKey(new Uint8Array(wallet.secretKey));
}

class SolPerpsBot {
  constructor(config) {
    this.config = config;
    this.connection = new Connection(
      config.rpcUrl || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    this.jupiter = new JupiterService(this, config.jupiterConfig);
    this.positions = new PositionManager(this, config.positionConfig);
    this.signals = new SignalEngine(this, config.signalConfig);
    this.telegram = new TelegramHandler(this, config.telegram);
    
    // Phantom wallet (user-connected)
    this.phantom = new PhantomWalletManager();
    
    // Price alerts
    this.priceAlerts = new Map();
    this.priceAlertInterval = null;
    
    // Load existing wallet or generate new one
    // No bot wallet - users connect their own
    // No bot wallet
    
    this.isPaperTrading = config.paperTrading || true;
    this.isRunning = false;
  }

  async start() {
    console.log('🤖 SOLPERPS Bot Starting...');
    console.log(`📋 Mode: ${this.isPaperTrading ? 'PAPER TRADING' : 'LIVE TRADING'}`);
    
    await this.jupiter.initialize();
    await this.positions.loadPositions();
    
    if (this.config.autoTrade) {
      this.signals.start();
    }
    
    this.isRunning = true;
    console.log('✅ Bot is running!');
    
    // Keep process alive
    setInterval(() => {}, 1000);
  }

  // ==================== TRADING ====================
  
  async openPosition(params) {
    const { symbol, side, size, leverage = 1 } = params;
    
    const position = {
      id: Date.now().toString(),
      symbol,
      side, // 'long' or 'short'
      size,
      leverage,
      entryPrice: await this.jupiter.getPrice(symbol),
      openedAt: new Date().toISOString(),
      status: 'open'
    };

    if (this.isPaperTrading) {
      console.log(`📝 [PAPER] Opening ${side} position: ${size} ${symbol} @ ${position.entryPrice}`);
      this.positions.add(position);
      return { success: true, position, mode: 'paper' };
    }

    try {
      const result = await this.jupiter.openPosition(position);
      this.positions.add(position);
      return { success: true, position: result, mode: 'live' };
    } catch (error) {
      console.error('❌ Failed to open position:', error.message);
      return { success: false, error: error.message };
    }
  }

  async closePosition(positionId) {
    const position = this.positions.get(positionId);
    if (!position) {
      return { success: false, error: 'Position not found' };
    }

    const currentPrice = await this.jupiter.getPrice(position.symbol);
    const pnl = this.calculatePnL(position, currentPrice);

    if (this.isPaperTrading) {
      console.log(`📝 [PAPER] Closing position ${positionId}: PnL = ${pnl}`);
      this.positions.remove(positionId);
      return { success: true, pnl, mode: 'paper' };
    }

    try {
      const result = await this.jupiter.closePosition(position);
      this.positions.remove(positionId);
      return { success: true, pnl, mode: 'live' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  calculatePnL(position, currentPrice) {
    const side = position.side === 'long' ? 1 : -1;
    const priceChange = (currentPrice - position.entryPrice) * side;
    const pnl = priceChange * position.size * position.leverage;
    return pnl;
  }

  // ==================== TP/SL ====================

  async checkTpSl() {
    const positions = this.positions.getAll();
    
    for (const pos of positions) {
      if (pos.status !== 'open') continue;
      
      const currentPrice = await this.jupiter.getPrice(pos.symbol);
      const pnl = this.calculatePnL(pos, currentPrice);
      const pnlPercent = (pnl / (pos.entryPrice * pos.size)) * 100;

      // Check Take Profit
      if (pos.tp && pnlPercent >= pos.tp) {
        console.log(`🎯 TP Triggered for ${pos.symbol}: +${pnlPercent.toFixed(2)}%`);
        await this.closePosition(pos.id);
        await this.notify(`🎯 Take Profit! +$${pnl.toFixed(2)} on ${pos.symbol}`);
      }

      // Check Stop Loss
      if (pos.sl && pnlPercent <= -pos.sl) {
        console.log(`🛑 SL Triggered for ${pos.symbol}: ${pnlPercent.toFixed(2)}%`);
        await this.closePosition(pos.id);
        await this.notify(`🛑 Stop Loss! -$${Math.abs(pnl).toFixed(2)} on ${pos.symbol}`);
      }
    }
  }

  setTpSl(positionId, tp, sl) {
    const position = this.positions.get(positionId);
    if (position) {
      position.tp = tp;
      position.sl = sl;
      this.positions.update(position);
      return { success: true, tp, sl };
    }
    return { success: false, error: 'Position not found' };
  }

  // ==================== BALANCE ====================

  async getBalance() {
    if (this.isPaperTrading) {
      return {
        mode: 'paper',
        sol: this.config.paperBalance || 10000,
        usd: (this.config.paperBalance || 10000) * await this.jupiter.getPrice('SOL')
      };
    }

    try {
      const balance = await this.connection.getTokenAccountBalance(
        new PublicKey(process.env.SOL_TOKEN_ACCOUNT)
      );
      return {
        mode: 'live',
        sol: balance.value.uiAmount,
        usd: balance.value.uiAmount * await this.jupiter.getPrice('SOL')
      };
    } catch (error) {
      // Try native SOL balance
      const balance = await this.connection.getBalance(this.wallet.publicKey);
      return {
        mode: 'live',
        sol: balance / 1e9,
        usd: (balance / 1e9) * await this.jupiter.getPrice('SOL')
      };
    }
  }

  // ==================== TRANSFERS ====================

  async transfer(toAddress, amount, token = 'SOL') {
    if (this.isPaperTrading) {
      console.log(`📝 [PAPER] Transfer ${amount} ${token} to ${toAddress}`);
      return { success: true, mode: 'paper', txId: 'paper_' + Date.now() };
    }

    try {
      const result = await this.jupiter.transfer(toAddress, amount, token);
      return { success: true, mode: 'live', txId: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== PRICE ALERTS ====================

  setPriceAlert(symbol, targetPrice, direction, chatId) {
    const alertId = Date.now().toString();
    this.priceAlerts.set(alertId, {
      symbol,
      targetPrice,
      direction, // 'above' or 'below'
      chatId,
      createdAt: new Date().toISOString()
    });
    
    // Start monitoring if not already running
    if (!this.priceAlertInterval) {
      this.startPriceAlertMonitoring();
    }
    
    return { success: true, alertId, symbol, targetPrice, direction };
  }

  removePriceAlert(alertId) {
    if (this.priceAlerts.has(alertId)) {
      this.priceAlerts.delete(alertId);
      return { success: true };
    }
    return { success: false, error: 'Alert not found' };
  }

  getPriceAlerts() {
    return Array.from(this.priceAlerts.entries()).map(([id, alert]) => ({
      id,
      ...alert
    }));
  }

  async startPriceAlertMonitoring() {
    this.priceAlertInterval = setInterval(async () => {
      for (const [alertId, alert] of this.priceAlerts) {
        try {
          const currentPrice = await this.jupiter.getPrice(alert.symbol);
          
          let triggered = false;
          if (alert.direction === 'above' && currentPrice >= alert.targetPrice) {
            triggered = true;
          } else if (alert.direction === 'below' && currentPrice <= alert.targetPrice) {
            triggered = true;
          }
          
          if (triggered) {
            const msg = `🔔 PRICE ALERT! ${alert.symbol} is now $${currentPrice.toFixed(2)} (${alert.direction} $${alert.targetPrice})`;
            await this.notify(msg);
            this.priceAlerts.delete(alertId);
          }
        } catch (e) {
          // Skip on error
        }
      }
      
      // Stop monitoring if no alerts
      if (this.priceAlerts.size === 0 && this.priceAlertInterval) {
        clearInterval(this.priceAlertInterval);
        this.priceAlertInterval = null;
      }
    }, 30000); // Check every 30 seconds
  }

  // ==================== LIVE PRICE ====================

  async getLivePrice(symbol) {
    return await this.jupiter.getPrice(symbol);
  }

  // ==================== POSITIONS ====================

  async getPositions() {
    return this.positions.getAll();
  }

  async getPosition(positionId) {
    return this.positions.get(positionId);
  }

  // ==================== NOTIFICATIONS ====================

  async notify(message) {
    if (this.telegram) {
      await this.telegram.send(message);
    }
    console.log(`📢 Notification: ${message}`);
  }

  // ==================== LIFECYCLE ====================

  async stop() {
    console.log('🛑 Stopping bot...');
    this.isRunning = false;
    this.signals.stop();
    console.log('✅ Bot stopped');
  }

  // ==================== WALLET ====================

  getWalletAddress() {
    return this.wallet.publicKey.toString();
  }

  exportWallet() {
    return {
      publicKey: this.wallet.publicKey.toString(),
      secretKey: Array.from(this.wallet.secretKey)
    };
  }
}

module.exports = { SolPerpsBot };

// ==================== MAIN ====================

if (require.main === module) {
  (async () => {
    const config = {
      rpcUrl: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
      paperTrading: process.env.PAPER_TRADING === 'true',
      autoTrade: process.env.AUTO_TRADE === 'true',
      jupiterConfig: {},
      positionConfig: {
        storagePath: process.env.POSITION_STORAGE || './data/positions.json'
      },
      signalConfig: {
        strategy: process.env.STRATEGY || 'ma-cross',
        autoExecute: process.env.AUTO_EXECUTE === 'true',
        symbol: process.env.SYMBOL || 'SOL',
        positionSize: parseFloat(process.env.POSITION_SIZE) || 10,
        leverage: parseFloat(process.env.LEVERAGE) || 1,
        interval: 60000
      },
      telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID
      }
    };
    
    const bot = new SolPerpsBot(config);
    botInstance = bot;
    await bot.start();
  })();
}
