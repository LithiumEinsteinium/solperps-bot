require('dotenv').config();
const http = require('http');
const { Connection, PublicKey } = require('@solana/web3.js');
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
    
    // User-connected Phantom wallet
    this.phantom = new PhantomWalletManager();
    
    // Price alerts
    this.priceAlerts = new Map();
    this.priceAlertInterval = null;
    
    // Parse paper trading - default to true if not set
    this.isPaperTrading = config.paperTrading === true || config.paperTrading === 'true';
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
  }

  // ==================== TRADING ====================
  
  async openPosition(params) {
    const { symbol, side, size, leverage = 1 } = params;
    
    const position = {
      id: Date.now().toString(),
      symbol,
      side,
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

      if (pos.tp && pnlPercent >= pos.tp) {
        console.log(`🎯 TP Triggered for ${pos.symbol}: +${pnlPercent.toFixed(2)}%`);
        await this.closePosition(pos.id);
        await this.notify(`🎯 Take Profit! +$${pnl.toFixed(2)} on ${pos.symbol}`);
      }

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
    try {
      // Check if user has connected their wallet
      const phantomStatus = this.phantom.getStatus();
      
      if (phantomStatus.connected && !this.isPaperTrading) {
        // Fetch real balance from connected wallet
        await this.phantom.fetchBalance();
        const status = this.phantom.getStatus();
        const solPrice = await this.jupiter.getPrice('SOL').catch(() => 0);
        return {
          mode: 'live',
          address: status.address,
          sol: status.balance || 0,
          usd: (status.balance || 0) * solPrice
        };
      }

      // Default to paper balance
      const solPrice = await this.jupiter.getPrice('SOL').catch(() => 86);
      return {
        mode: 'paper',
        sol: 10000,
        usd: 10000 * solPrice
      };
    } catch (error) {
      console.error('Balance error:', error.message);
      return { mode: 'error', sol: 0, usd: 0 };
    }
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
