const axios = require('axios');

class SignalEngine {
  constructor(bot, config = {}) {
    this.bot = bot;
    this.config = config;
    this.interval = config.interval || 60000; // Check every minute
    this.intervalId = null;
    this.strategies = new Map();
    
    // Register default strategies
    this.registerStrategy('ma-cross', this.maCrossStrategy.bind(this));
    this.registerStrategy('rsi', this.rsiStrategy.bind(this));
    this.registerStrategy('signal', this.externalSignalStrategy.bind(this));
  }

  registerStrategy(name, fn) {
    this.strategies.set(name, fn);
    console.log(`📈 Registered strategy: ${name}`);
  }

  start() {
    if (this.intervalId) {
      console.log('⚠️ Signal engine already running');
      return;
    }

    console.log('🚀 Starting signal engine...');
    this.intervalId = setInterval(async () => {
      await this.checkStrategies();
      await this.bot.checkTpSl();
    }, this.interval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🛑 Signal engine stopped');
    }
  }

  async checkStrategies() {
    const activeStrategy = this.config.strategy || 'ma-cross';
    const strategyFn = this.strategies.get(activeStrategy);
    
    if (strategyFn) {
      try {
        await strategyFn();
      } catch (error) {
        console.error('Strategy error:', error.message);
      }
    }
  }

  // ==================== STRATEGIES ====================

  async maCrossStrategy() {
    // Simple Moving Average Crossover
    const symbol = this.config.symbol || 'SOL';
    const fastPeriod = this.config.fastPeriod || 9;
    const slowPeriod = this.config.slowPeriod || 21;
    
    const prices = await this.getHistoricalPrices(symbol, 50);
    if (prices.length < slowPeriod) return;

    const fastMA = this.calculateMA(prices.slice(-fastPeriod));
    const slowMA = this.calculateMA(prices.slice(-slowPeriod));
    const prevFastMA = this.calculateMA(prices.slice(-fastPeriod - 1, -1));
    const prevSlowMA = this.calculateMA(prices.slice(-slowPeriod - 1, -1));

    // Golden Cross (buy signal)
    if (prevFastMA <= prevSlowMA && fastMA > slowMA) {
      await this.executeSignal({ 
        type: 'long', 
        reason: 'MA Golden Cross',
        price: prices[prices.length - 1]
      });
    }
    
    // Death Cross (sell signal)
    if (prevFastMA >= prevSlowMA && fastMA < slowMA) {
      await this.executeSignal({ 
        type: 'short', 
        reason: 'MA Death Cross',
        price: prices[prices.length - 1]
      });
    }
  }

  async rsiStrategy() {
    // RSI Strategy - buy oversold, sell overbought
    const symbol = this.config.symbol || 'SOL';
    const period = this.config.period || 14;
    const oversold = this.config.oversold || 30;
    const overbought = this.config.overbought || 70;
    
    const prices = await this.getHistoricalPrices(symbol, 50);
    if (prices.length < period) return;

    const rsi = this.calculateRSI(prices.slice(-period * 2), period);
    const currentPrice = prices[prices.length - 1];

    if (rsi < oversold) {
      await this.executeSignal({
        type: 'long',
        reason: `RSI Oversold (${rsi.toFixed(2)})`,
        price: currentPrice
      });
    } else if (rsi > overbought) {
      await this.executeSignal({
        type: 'short',
        reason: `RSI Overbought (${rsi.toFixed(2)})`,
        price: currentPrice
      });
    }
  }

  async externalSignalStrategy() {
    // This can be triggered by external webhooks/API
    // Check for pending signals in a file or API
    try {
      const signalFile = this.config.signalFile || './data/signal.json';
      const fs = require('fs');
      
      if (fs.existsSync(signalFile)) {
        const signal = JSON.parse(fs.readFileSync(signalFile, 'utf8'));
        
        if (signal.action && !signal.executed) {
          await this.executeSignal(signal);
          signal.executed = true;
          fs.writeFileSync(signalFile, JSON.stringify(signal, null, 2));
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }

  // ==================== EXECUTION ====================

  async executeSignal(signal) {
    if (!this.config.autoExecute) {
      console.log(`📡 Signal: ${signal.type} - ${signal.reason}`);
      return;
    }

    console.log(`🎯 Executing signal: ${signal.type} - ${signal.reason}`);
    
    const size = this.config.positionSize || 10;
    const symbol = this.config.symbol || 'SOL';
    
    if (signal.type === 'long') {
      await this.bot.openPosition({
        symbol,
        side: 'long',
        size,
        leverage: this.config.leverage || 1
      });
    } else if (signal.type === 'short') {
      await this.bot.openPosition({
        symbol,
        side: 'short',
        size,
        leverage: this.config.leverage || 1
      });
    }
  }

  // ==================== INDICATORS ====================

  calculateMA(prices) {
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  calculateRSI(prices, period) {
    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  async getHistoricalPrices(symbol, limit) {
    // In production, this would fetch from an API
    // For now, return mock data
    const basePrice = symbol === 'SOL' ? 85 : symbol === 'BTC' ? 68000 : 2000;
    return Array.from({ length: limit }, () => 
      basePrice + (Math.random() - 0.5) * basePrice * 0.1
    );
  }

  // ==================== EXTERNAL SIGNALS ====================

  setSignal(signal) {
    const fs = require('fs');
    const signalFile = this.config.signalFile || './data/signal.json';
    const dir = require('path').dirname(signalFile);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(signalFile, JSON.stringify({
      ...signal,
      receivedAt: new Date().toISOString()
    }, null, 2));
  }
}

module.exports = { SignalEngine };
