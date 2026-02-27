# On-Chain Trading Implementation Plan

## Current State
- Bot works in paper trading mode
- Users can connect wallet via `/connect ADDRESS`
- No real on-chain trades executed

---

## Available Options for Perps Trading

### 1. Jupiter Perps (Recommended)
**Status:** Work in Progress (API not stable)  
**Pros:** Largest DEX aggregator on Solana  
**Cons:** API not fully released yet

**Would need:**
- Wait for stable API release
- Or use their SDK directly (Anchor IDL parsing)

### 2. Meteora Perps
**Status:** Available  
**Pros:** Growing liquidity, good docs  
**Cons:** Newer, less volume

### 3. Drift Protocol
**Status:** Available  
**Pros:** Established, full trading suite  
**Cons:** Complex integration

### 4. 01 Protocol
**Status:** Available  
**Pros:** Concentrated liquidity  
**Cons:** Smaller volume

---

## Architecture Needed

```
┌─────────────────────────────────────────────────────────┐
│                    Telegram Bot                          │
│  /long SOL 10 → /short SOL 5 → /close 12345            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               Trading Service                            │
│  1. Validate position request                           │
│  2. Check wallet balance                                │
│  3. Calculate position size & margin                    │
│  4. Build transaction                                   │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ Phantom   │  │ Jupiter  │  │ Position │
   │ Signing  │  │ Perps API│  │ Manager  │
   └──────────┘  └──────────┘  └──────────┘
```

---

## Implementation Steps

### Phase 1: Wallet Connection (Enhanced)
- [ ] Get Phantom App ID (requires registration)
- [ ] Or: Build web-based wallet connection flow
- [ ] Store connected wallet per user (chat_id → address)

### Phase 2: Balance & Position Fetching
- [ ] Fetch real SOL/USDC balance from connected wallet
- [ ] Fetch open positions from blockchain
- [ ] Calculate unrealized PnL

### Phase 3: Trade Execution
- [ ] Integrate Jupiter Perps SDK
- [ ] Build "open position" transaction
- [ ] Generate signing request for Phantom
- [ ] Send tx via webhook/callback

### Phase 4: Position Management
- [ ] Close position
- [ ] Set TP/SL (on-chain or off-chain monitoring)
- [ ] Real-time position updates

---

## Key Technical Challenges

### 1. Transaction Signing
**Problem:** Bot can't sign transactions - user must sign with Phantom

**Solutions:**
- **Option A:** Deep link to Phantom app with tx data
- **Option B:** Web page with Phantom SDK (requires App ID)
- **Option C:** User signs in web wallet, bot broadcasts

### 2. User Session Management
**Problem:** Each Telegram user needs their own wallet connection

**Solution:**
```javascript
userWallets = {
  '1729150103': 'SOL_ADDRESS_HERE',
  // ...
}
```

### 3. Gas/Fees
**Problem:** Who pays transaction fees?

**Solution:**
- User pays own fees (deducted from position)
- Or: Bot pays, deducted from user balance

---

## Questions for Decision

1. **Which perps protocol?**
   - Jupiter (when stable) vs Meteora vs Drift

2. **Signing flow?**
   - Deep link (needs App ID)
   - Web SDK (needs App ID)
   - Manual tx (user signs elsewhere, sends to bot)

3. **Fee structure?**
   - Just platform fees?
   - Mark up spreads?

4. **Supported assets?**
   - SOL only to start?
   - BTC, ETH, others?

---

## Quick Win: Hybrid Approach

For immediate progress, we could:

1. **Keep paper trading** as main mode
2. **Add real balance display** (fetch from wallet)
3. **Build tx builder** (generate unsigned txs)
4. **User signs manually** and broadcasts

This gives real trading capability without waiting for Phantom App ID.

---

*Draft: 2026-02-26*
