/**
 * On-Chain Trading Service
 * Handles real trades on Solana using Jupiter API
 */

const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58');
const axios = require('axios');

class OnChainTrader {
  constructor(config = {}) {
    this.config = config;
    this.connection = new Connection(
      config.rpcUrl || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    console.log('✅ OnChain Trader initialized (API mode)');
  }

  /**
   * Get keypair from user's stored private key
   */
  getKeypairFromPrivateKey(privateKeyBase58) {
    try {
      const bytes = bs58.decode(privateKeyBase58);
      return Keypair.fromSecretKey(bytes);
    } catch (error) {
      throw new Error('Invalid private key: ' + error.message);
    }
  }

  /**
   * Get wallet balance
   */
  async getBalance(privateKeyBase58) {
    try {
      const keypair = this.getKeypairFromPrivateKey(privateKeyBase58);
      const balance = await this.connection.getBalance(keypair.publicKey);
      return {
        sol: balance / 1e9,
        lamports: balance
      };
    } catch (error) {
      console.error('Balance error:', error.message);
      return { sol: 0, lamports: 0, error: error.message };
    }
  }

  /**
   * Get token balance (USDC, etc)
   */
  async getTokenBalance(privateKeyBase58, tokenMint) {
    try {
      const keypair = this.getKeypairFromPrivateKey(privateKeyBase58);
      
      // Get token accounts
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        keypair.publicKey,
        { mint: new PublicKey(tokenMint) }
      );

      if (tokenAccounts.value.length === 0) {
        return { amount: 0, decimals: 0 };
      }

      const account = tokenAccounts.value[0];
      const amount = account.account.data.parsed.info.tokenAmount;
      
      return {
        amount: amount.uiAmountString || 0,
        decimals: amount.decimals,
        raw: amount.amount
      };
    } catch (error) {
      console.error('Token balance error:', error.message);
      return { amount: 0, error: error.message };
    }
  }

  /**
   * Execute a swap (SOL <-> USDC)
   */
  async swap(privateKeyBase58, fromToken, toToken, amount) {
    try {
      const keypair = this.getKeypairFromPrivateKey(privateKeyBase58);
      
      // Get mint addresses
      const fromMint = this.getMintAddress(fromToken);
      const toMint = this.getMintAddress(toToken);
      
      console.log(`🔄 Swapping ${amount} ${fromToken} -> ${toMint}`);
      
      // Get quote from Jupiter API
      const quoteResponse = await axios.get('https://quote-api.jup.ag/v6/quote', {
        params: {
          inputMint: fromMint,
          outputMint: toMint,
          amount: amount * Math.pow(10, fromToken === 'SOL' ? 9 : 6),
          slippage: 0.5,
          platformFee: 0
        }
      });

      const quote = quoteResponse.data;
      if (!quote || !quote.routePlan) {
        throw new Error('No route found for swap');
      }

      // Get swap transaction
      const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toString(),
        wrapAndUnwrapSol: true
      });

      const swapTransaction = swapResponse.data.swapTransaction;

      // Deserialize and sign
      const transaction = Transaction.from(
        Buffer.from(swapTransaction, 'base64')
      );

      // Sign transaction
      transaction.sign(keypair);

      // Serialize
      const signedTransaction = transaction.serialize();

      // Send
      const txid = await this.connection.sendRawTransaction(signedTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });

      // Confirm
      await this.connection.confirmTransaction(txid, 'confirmed');

      console.log(`✅ Swap complete: ${txid}`);
      
      return {
        success: true,
        txid,
        fromToken,
        toToken,
        amount
      };

    } catch (error) {
      console.error('Swap error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get mint address for token symbol
   */
  getMintAddress(symbol) {
    const tokens = {
      'SOL': 'So11111111111111111111111111111111111111112',
      'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'BTC': '9n4nbM75f5i33EqDUw8qp9784cvh5vceyn6tes2yzrb2',
      'ETH': '2FPyTwcZLUg1MDrwsyoP4D86sWN7Q6emerkys8Rchww',
      'WIF': '85VBFQZC9TZkfaptBWqv14ALD9fJNUKtFW41h8AyjMmx',
      'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixSBX8mQ8GMHvFErGiA'
    };
    
    return tokens[symbol.toUpperCase()] || symbol;
  }

  /**
   * Transfer SOL to another address
   */
  async transfer(privateKeyBase58, toAddress, amount) {
    try {
      const keypair = this.getKeypairFromPrivateKey(privateKeyBase58);
      const toPubkey = new PublicKey(toAddress);
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: toPubkey,
          lamports: amount * 1e9
        })
      );

      transaction.sign(keypair);
      
      const txid = await this.connection.sendRawTransaction(
        transaction.serialize(),
        { skipPreflight: false }
      );

      await this.connection.confirmTransaction(txid, 'confirmed');

      return { success: true, txid, amount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get recent transactions for a wallet
   */
  async getTransactions(privateKeyBase58, limit = 5) {
    try {
      const keypair = this.getKeypairFromPrivateKey(privateKeyBase58);
      const signatures = await this.connection.getSignaturesForAddress(
        keypair.publicKey,
        { limit }
      );
      
      return signatures;
    } catch (error) {
      return [];
    }
  }
}

module.exports = { OnChainTrader };
