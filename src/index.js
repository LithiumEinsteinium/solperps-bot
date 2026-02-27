require('dotenv').config();
const http = require('http');
const { Connection, PublicKey } = require('@solana/web3.js');
const { JupiterService } = require('./services/jupiter');
const { PositionManager } = require('./services/positionManager');
const { SignalEngine } = require('./strategies/signalEngine');
const { TelegramHandler } = require('./handlers/telegram');
const { PhantomWalletManager } = require('./services/phantomWallet');
const { UserWalletManager } = require('./services/userWallet');
const { OnChainTrader } = require('./services/onChainTrader');
// Try to load Drift SDK, but don't fail if it doesn't work
let PerpetualsService;
let MARKETS;

try {
  const perpsModule = require('./services/perpetuals.js');
  PerpetualsService = perpsModule.PerpetualsService;
  MARKETS = perpsModule.MARKETS;
  console.log('📊 Perpetuals module loaded');
} catch (error) {
  console.log('⚠️ Perpetuals not available:', error.message);
  PerpetualsService = null;
}

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
    
    // Built-in wallet per user
    this.userWallets = new UserWalletManager('./data/user_wallets.json');
    
    // Testnet mode per user
    this.userTestnet = new Map();
    
    // On-chain trading
    this.trader = new OnChainTrader({
      rpcUrl: config.rpcUrl
    });
    
    // Perpetuals trading (Drift)
    this.perps = PerpetualsService ? new PerpetualsService({
      rpcUrl: config.rpcUrl
    }) : null;
    
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
      // Check if user has connected their Phantom wallet
      const phantomStatus = this.phantom.getStatus();
      
      if (phantomStatus.connected && !this.isPaperTrading) {
        // Fetch real balance from connected Phantom wallet
        await this.phantom.fetchBalance();
        const status = this.phantom.getStatus();
        const solPrice = await this.jupiter.getPrice('SOL').catch(() => 86);
        return {
          mode: 'live',
          address: status.address,
          sol: status.balance || 0,
          usd: (status.balance || 0) * solPrice
        };
      }

      // In paper trading mode, show paper balance
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

  // Get user's bot wallet address
  getUserWalletAddress(chatId) {
    return this.userWallets.getAddress(chatId);
  }

  // Get user's bot wallet private key for export
  getUserWalletPrivateKey(chatId) {
    return this.userWallets.getPrivateKey(chatId);
  }

  // ==================== ON-CHAIN TRADING ====================

  async getOnChainBalance(chatId) {
    const privateKey = this.getUserWalletPrivateKey(chatId);
    if (!privateKey) return { sol: 0, error: 'No wallet' };
    
    const solBalance = await this.trader.getBalance(privateKey);
    const usdcBalance = await this.trader.getTokenBalance(privateKey, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    
    return {
      sol: solBalance.sol,
      usdc: usdcBalance.amount || 0
    };
  }

  async swapTokens(chatId, fromToken, toToken, amount) {
    const privateKey = this.getUserWalletPrivateKey(chatId);
    if (!privateKey) return { success: false, error: 'No wallet' };
    
    return await this.trader.swap(privateKey, fromToken, toToken, amount);
  }

  async transferSol(chatId, toAddress, amount) {
    const privateKey = this.getUserWalletPrivateKey(chatId);
    if (!privateKey) return { success: false, error: 'No wallet' };
    
    return await this.trader.transfer(privateKey, toAddress, amount);
  }

  // ==================== PERPETUALS ====================

  async initPerps(chatId) {
    if (!this.perps) return { success: false, error: 'Perpetuals not available' };
    const privateKey = this.getUserWalletPrivateKey(chatId);
    if (!privateKey) return { success: false, error: 'No wallet' };
    
    return await this.perps.initialize(privateKey);
  }

    async openPerpPosition(chatId, symbol, side, amount, leverage) {
    // Paper trading mode - simulate perp positions
    if (this.isPaperTrading) {
      const position = {
        id: 'perp_' + Date.now(),
        symbol,
        side,
        size: amount,
        leverage,
        entryPrice: await this.jupiter.getPrice(symbol),
        openedAt: new Date().toISOString(),
        type: 'perp'
      };
      
      this.positions.add(position);
      console.log(`📝 [PAPER PERP] Opening ${side} ${leverage}x: ${amount} ${symbol} @ ${position.entryPrice}`);
      
      return { 
        success: true, 
        position,
        mode: 'paper',
        message: `📝 *Paper Perp Opened*\n\n${symbol}: ${side.toUpperCase()} ${leverage}x\nAmount: ${amount} USDC\nEntry: $${position.entryPrice}`
      };
    }
    
    if (!this.perps) return { success: false, error: 'Perpetuals not available' };
    
    // Check user testnet mode
    const isTestnet = this.userTestnet?.get(chatId.toString()) || false;
    const privateKey = this.getUserWalletPrivateKey(chatId);
    if (!privateKey) return { success: false, error: 'No wallet' };
    
    // Reinitialize if not initialized, or if wallet/network changed
    const needsInit = !this.perps.initialized || 
                      this.perps.isTestnet !== isTestnet ||
                      this.perps.lastWalletKey !== privateKey;
    
    if (needsInit) {
      console.log('🔄 Reinitializing Drift with new wallet...');
      const initResult = await this.perps.initialize(privateKey, { testnet: isTestnet });
      if (!initResult.success) {
        return { success: false, error: 'Init failed: ' + initResult.error };
      }
      this.perps.lastWalletKey = privateKey;
    }
    
    return await this.perps.openPosition(symbol, side, amount, leverage);
  }

  async closePerpPosition(chatId, positionIndex) {
    // Paper trading mode
    if (this.isPaperTrading) {
      const positions = this.positions.getAll().filter(p => p.type === 'perp');
      const position = positions[positionIndex];
      
      if (!position) {
        return { success: false, error: 'Position not found' };
      }
      
      const currentPrice = await this.jupiter.getPrice(position.symbol);
      const pnl = position.side === 'long' 
        ? (currentPrice - position.entryPrice) * position.size
        : (position.entryPrice - currentPrice) * position.size;
      
      this.positions.remove(position.id);
      
      return { 
        success: true, 
        position,
        pnl,
        mode: 'paper',
        message: `📝 *Paper Perp Closed*\n\n${position.symbol}: ${position.side.toUpperCase()}\nEntry: $${position.entryPrice}\nExit: $${currentPrice}\nPnL: $${pnl.toFixed(2)}`
      };
    }
    
    if (!this.perps) return { success: false, error: 'Perpetuals not available' };
    
    const isTestnet = this.userTestnet?.get(chatId.toString()) || false;
    const privateKey = this.getUserWalletPrivateKey(chatId);
    if (!privateKey) return { success: false, error: 'No wallet' };
    
    // Reinitialize if needed
    const needsInit = !this.perps.initialized || 
                      this.perps.isTestnet !== isTestnet ||
                      this.perps.lastWalletKey !== privateKey;
    
    if (needsInit) {
      const initResult = await this.perps.initialize(privateKey, { testnet: isTestnet });
      if (!initResult.success) {
        return { success: false, error: 'Init failed: ' + initResult.error };
      }
      this.perps.lastWalletKey = privateKey;
    }
    
    return await this.perps.closePosition(positionIndex);
  }

  async getPerpPositions(chatId) {
    // Paper trading mode
    if (this.isPaperTrading) {
      const perpPositions = this.positions.getAll().filter(p => p.type === 'perp');
      return perpPositions.map((p, i) => ({
        index: i,
        ...p,
        currentPrice: this.jupiter.getPriceSync ? this.jupiter.getPriceSync(p.symbol) : null,
        mode: 'paper'
      }));
    }
    
    if (!this.perps) return [];
    
    const isTestnet = this.userTestnet?.get(chatId.toString()) || false;
    const privateKey = this.getUserWalletPrivateKey(chatId);
    if (!privateKey) return [];
    
    // Reinitialize if needed
    const needsInit = !this.perps.initialized || 
                      this.perps.isTestnet !== isTestnet ||
                      this.perps.lastWalletKey !== privateKey;
    
    if (needsInit) {
      await this.perps.initialize(privateKey, { testnet: isTestnet });
      this.perps.lastWalletKey = privateKey;
    }
    
    return await this.perps.getPositions();
  }

  async getPerpAccountInfo(chatId) {
    if (!this.perps) return null;
    
    if (!this.perps.initialized) {
      const privateKey = this.getUserWalletPrivateKey(chatId);
      if (!privateKey) return null;
      await this.perps.initialize(privateKey);
    }
    
    return await this.perps.getAccountInfo();
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

  getPriceAlerts() {
    return Array.from(this.priceAlerts.values());
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
      rpcUrl: process.env.RPC_URL || process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
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
