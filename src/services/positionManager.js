const fs = require('fs');
const path = require('path');

class PositionManager {
  constructor(bot, config = {}) {
    this.bot = bot;
    this.config = config;
    this.positions = new Map();
    this.storagePath = config.storagePath || './data/positions.json';
    this.loadPositions();
  }

  loadPositions() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
        data.forEach(pos => this.positions.set(pos.id, pos));
        console.log(`📂 Loaded ${this.positions.size} positions`);
      }
    } catch (error) {
      console.log('⚠️ No existing positions found, starting fresh');
    }
  }

  savePositions() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify(Array.from(this.positions.values()), null, 2)
      );
    } catch (error) {
      console.error('Failed to save positions:', error.message);
    }
  }

  add(position) {
    this.positions.set(position.id, position);
    this.savePositions();
    console.log(`➕ Position added: ${position.id}`);
  }

  update(position) {
    if (this.positions.has(position.id)) {
      this.positions.set(position.id, position);
      this.savePositions();
      return true;
    }
    return false;
  }

  remove(positionId) {
    if (this.positions.has(positionId)) {
      this.positions.delete(positionId);
      this.savePositions();
      console.log(`➖ Position removed: ${positionId}`);
      return true;
    }
    return false;
  }

  get(positionId) {
    return this.positions.get(positionId);
  }

  getAll() {
    return Array.from(this.positions.values()).filter(p => p.status === 'open');
  }

  getAllIncludingClosed() {
    return Array.from(this.positions.values());
  }

  getBySymbol(symbol) {
    return this.getAll().filter(p => p.symbol === symbol);
  }

  getSummary() {
    const positions = this.getAll();
    let totalPnl = 0;
    
    positions.forEach(pos => {
      const currentPrice = this.bot.jupiter.getPrice(pos.symbol) || pos.entryPrice;
      const pnl = this.bot.calculatePnL(pos, currentPrice);
      totalPnl += pnl;
    });

    return {
      openPositions: positions.length,
      totalPnl,
      positions: positions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        entryPrice: p.entryPrice,
        pnl: this.bot.calculatePnL(p, this.bot.jupiter.getPrice(p.symbol) || p.entryPrice)
      }))
    };
  }
}

module.exports = { PositionManager };
