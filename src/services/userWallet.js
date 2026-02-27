/**
 * User Wallet Manager
 * Each user gets their own wallet, stored by chat_id
 * Users can export their private key to access funds externally
 */

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const fs = require('fs');
const path = require('path');

class UserWalletManager {
  constructor(storagePath = './data/user_wallets.json') {
    this.storagePath = storagePath;
    this.wallets = new Map(); // chat_id -> { address, privateKey }
    this.loadWallets();
  }

  loadWallets() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
        this.wallets = new Map(Object.entries(data));
        console.log(`📁 Loaded ${this.wallets.size} user wallets`);
      }
    } catch (error) {
      console.log('📁 No existing wallets file, starting fresh');
    }
  }

  saveWallets() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.wallets);
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save wallets:', error.message);
    }
  }

  /**
   * Get or create wallet for a user
   */
  getWallet(chatId) {
    const id = chatId.toString();
    
    if (this.wallets.has(id)) {
      return this.wallets.get(id);
    }
    
    // Generate new wallet
    const keypair = Keypair.generate();
    const privateKeyBytes = keypair.secretKey;
    const privateKeyBase58 = bs58.encode(privateKeyBytes);
    const address = keypair.publicKey.toString();
    
    const wallet = {
      address,
      privateKey: privateKeyBase58, // Base58 format for Phantom
      createdAt: new Date().toISOString()
    };
    
    this.wallets.set(id, wallet);
    this.saveWallets();
    
    console.log(`👛 Created new wallet for user ${id}: ${address}`);
    return wallet;
  }

  /**
   * Get wallet address only
   */
  getAddress(chatId) {
    const wallet = this.getWallet(chatId);
    return wallet.address;
  }

  /**
   * Get private key in base58 format (Phantom-compatible)
   */
  getPrivateKey(chatId) {
    const wallet = this.getWallet(chatId);
    return wallet.privateKey;
  }

  /**
   * Get private key as JSON array (for some wallets)
   */
  getPrivateKeyArray(chatId) {
    const wallet = this.getWallet(chatId);
    const bytes = bs58.decode(wallet.privateKey);
    return Array.from(bytes);
  }

  /**
   * Check if user has a wallet
   */
  hasWallet(chatId) {
    return this.wallets.has(chatId.toString());
  }

  /**
   * Delete wallet (user wants to reset)
   */
  deleteWallet(chatId) {
    const id = chatId.toString();
    if (this.wallets.has(id)) {
      this.wallets.delete(id);
      this.saveWallets();
      return true;
    }
    return false;
  }

  /**
   * Import wallet from private key
   */
  importWallet(chatId, privateKeyInput) {
    const id = chatId.toString();
    
    let bytes;
    let privateKeyBase58;
    
    try {
      privateKeyInput = privateKeyInput.trim();
      console.log('Import attempt, input length:', privateKeyInput.length, 'first 20:', privateKeyInput.substring(0, 20));
      
      // Try parsing as JSON array first: [20, 120, 76, ...]
      if (privateKeyInput.startsWith('[')) {
        const arr = JSON.parse(privateKeyInput);
        bytes = new Uint8Array(arr);
        console.log('Parsed as JSON array, length:', bytes.length);
      } 
      // Try parsing as JSON array string without brackets
      else if (privateKeyInput.includes(',') && !privateKeyInput.startsWith('4')) {
        const cleanArr = privateKeyInput.replace('[', '').replace(']', '').split(',').map(n => parseInt(n.trim()));
        bytes = new Uint8Array(cleanArr);
        console.log('Parsed as comma array, length:', bytes.length);
      }
      // Try base58 (most common for Phantom)
      else {
        try {
          bytes = bs58.decode(privateKeyInput);
          console.log('Parsed as base58, length:', bytes.length);
        } catch (e) {
          // Try as hex
          bytes = new Uint8Array(privateKeyInput.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
          console.log('Parsed as hex, length:', bytes.length);
        }
      }
      
      // Validate length - accept 32 or handle 64 (sometimes keys get double encoded)
      if (bytes.length === 64) {
        // Might be [privateKey, publicKey] array - take first 32 bytes
        bytes = bytes.slice(0, 32);
      }
      
      if (bytes.length !== 32) {
        return { success: false, error: `Key length ${bytes.length}, need 32 bytes. Make sure you copied the full key.` };
      }
      
      const keypair = Keypair.fromSecretKey(bytes);
      const address = keypair.publicKey.toString();
      
      // Store as base58 for consistency
      privateKeyBase58 = bs58.encode(bytes);
      
      const wallet = {
        address,
        privateKey: privateKeyBase58,
        importedAt: new Date().toISOString()
      };
      
      this.wallets.set(id, wallet);
      this.saveWallets();
      
      return { success: true, address };
    } catch (error) {
      return { success: false, error: 'Invalid key: ' + error.message };
    }
  }

  /**
   * Format address for display
   */
  formatAddress(address) {
    if (!address) return 'None';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}

module.exports = { UserWalletManager };
