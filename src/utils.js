'use strict';

/**
 * 🚀 Web3 & 0x API Utilities
 * 
 * Provides secure, production-ready helpers for Ethereum interactions,
 * transaction handling, and 0x DEX API integration.
 * 
 * @module web3-utils
 * @requires @truffle/hdwallet-provider
 * @requires web3
 * @requires bignumber.js
 */

const HDWalletProvider = require('@truffle/hdwallet-provider');
const BigNumber = require('bignumber.js');
const Web3 = require('web3');

// ========== CONFIGURATION ==========

/** 
 * 0x API endpoint for swap quotes 
 * @constant {string}
 */
const API_QUOTE_URL = 'https://api.0x.org/swap/v1/quote';

/**
 * Validate required environment variables on startup
 */
const MNEMONIC = process.env.MNEMONIC;
const RPC_URL = process.env.RPC_URL;

if (!RPC_URL) {
  throw new Error('❌ RPC_URL environment variable is required');
}

console.log('🔐 Web3 Utils initialized', {
  hasMnemonic: !!MNEMONIC,
  rpcUrl: RPC_URL.replace(/(https?:\/\/)[^@]+@/, '$1***@'), // Mask auth
});

// ========== TYPE DEFINITIONS ==========

/**
 * @typedef {Object} TransactionReceipt
 * @property {string} transactionHash - The transaction hash
 * @property {string} blockHash - The block hash
 * @property {number} blockNumber - The block number
 * @property {number} status - 1 for success, 0 for failure
 */

// ========== CORE UTILITIES ==========

/**
 * Convert Ether to Wei (handles decimal precision safely)
 * @param {string|number} etherAmount - Amount in Ether
 * @returns {string} Amount in Wei as string
 * @example
 * etherToWei('1.5') // '1500000000000000000'
 */
function etherToWei(etherAmount) {
  return new BigNumber(etherAmount)
    .times('1e18')
    .integerValue(BigNumber.ROUND_DOWN)
    .toFixed(0);
}

/**
 * Convert Wei to Ether (handles large numbers safely)
 * @param {string|number} weiAmount - Amount in Wei
 * @returns {string} Amount in Ether as string
 * @example
 * weiToEther('1500000000000000000') // '1.5'
 */
function weiToEther(weiAmount) {
  return new BigNumber(weiAmount)
    .div('1e18')
    .toString();
}

/**
 * Create a query string from object parameters
 * @param {Record<string, any>} params - Object of query parameters
 * @returns {string} URL-encoded query string
 * @example
 * createQueryString({ buyToken: 'USDC', sellToken: 'ETH' }) 
 * // 'buyToken=USDC&sellToken=ETH'
 */
function createQueryString(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ========== WEB3 PROVIDER MANAGEMENT ==========

/**
 * Create a Web3 provider with optional HDWallet support
 * @private
 * @returns {Web3.providers.HttpProvider|HDWalletProvider}
 * @throws {Error} If RPC_URL is invalid
 */
function createProvider() {
  const isWebsocket = /^ws?:\/\//.test(RPC_URL);
  const baseProvider = isWebsocket 
    ? new Web3.providers.WebsocketProvider(RPC_URL, {
        reconnect: {
          auto: true,
          delay: 5000,
          maxAttempts: 5,
        },
      })
    : new Web3.providers.HttpProvider(RPC_URL, {
        keepAlive: true,
        timeout: 60000,
      });

  if (!MNEMONIC) {
    console.warn('⚠️  No MNEMONIC provided. Using read-only provider.');
    return baseProvider;
  }

  console.log('🔑 Using HDWallet provider (mnemonic-based)');
  
  return new HDWalletProvider({
    mnemonic: {
      phrase: MNEMONIC,
    },
    providerOrUrl: baseProvider,
    addressIndex: 0,
    numAddresses: 1,
  });
}

/**
 * Create a configured Web3 instance
 * @returns {Web3} Initialized Web3 instance
 * @throws {Error} If provider creation fails
 */
function createWeb3() {
  try {
    const provider = createProvider();
    return new Web3(provider);
  } catch (error) {
    console.error('Failed to create Web3 instance:', error);
    throw new Error(`Web3 initialization failed: ${error.message}`);
  }
}

// ========== TRANSACTION HANDLING ==========

/**
 * Wait for a transaction to be mined with enhanced error handling
 * @param {Object} tx - Web3 transaction object
 * @returns {Promise<TransactionReceipt>} Transaction receipt
 * @throws {Error} If transaction fails or is rejected
 * 
 * @example
 * const receipt = await waitForTxSuccess(myContract.methods.transfer(...).send({ from }));
 * console.log('Transaction confirmed:', receipt.transactionHash);
 */
function waitForTxSuccess(tx) {
  return new Promise((resolve, reject) => {
    if (!tx || typeof tx.on !== 'function') {
      return reject(new Error('Invalid transaction object'));
    }

    tx.on('error', (err) => {
      console.error('Transaction error:', err);
      reject(err);
    });

    tx.on('receipt', (receipt) => {
      console.log('✅ Transaction mined:', receipt.transactionHash);
      resolve(receipt);
    });

    // Timeout after 10 minutes
    const timeout = setTimeout(() => {
      tx.removeAllListeners();
      reject(new Error('Transaction timeout after 10 minutes'));
    }, 600000);

    // Clear timeout on completion
    tx.on('receipt', () => clearTimeout(timeout));
    tx.on('error', () => clearTimeout(timeout));
  });
}

// ========== 0X API METHODS ==========

/**
 * Fetch a swap quote from 0x Protocol
 * @param {Object} params - Quote parameters
 * @returns {Promise<Object>} 0x API response
 * @throws {Error} If API request fails
 * 
 * @example
 * const quote = await getSwapQuote({
 *   sellToken: 'ETH',
 *   buyToken: 'USDC',
 *   sellAmount: etherToWei('1')
 * });
 */
async function getSwapQuote(params) {
  const queryString = createQueryString(params);
  const url = `${API_QUOTE_URL}?${queryString}`;
  
  console.log('📡 Fetching 0x quote:', { url: url.replace(/(sellAmount|takerAddress)=([^&]+)/, '$1=***') });
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'web3-utils/1.0',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`0x API error (${response.status}): ${errorBody}`);
    }

    return await response.json();
  } catch (error) {
    console.error('0x API request failed:', error);
    throw error;
  }
}

// ========== EXPORTS ==========

module.exports = {
  // Conversion utilities
  etherToWei,
  weiToEther,
  createQueryString,
  
  // Web3 setup
  createWeb3,
  createProvider,
  
  // Transaction handling
  waitForTxSuccess,
  
  // 0x Protocol
  getSwapQuote,
  API_QUOTE_URL,
  
  // Configuration (for advanced use)
  config: {
    hasMnemonic: !!MNEMONIC,
    rpcUrl: RPC_URL,
  },
};

// ========== USAGE EXAMPLE ==========

/*
const { createWeb3, etherToWei, waitForTxSuccess } = require('./web3-utils');

async function main() {
  const web3 = createWeb3();
  const accounts = await web3.eth.getAccounts();
  console.log('Using account:', accounts[0]);
  
  const tx = web3.eth.sendTransaction({
    from: accounts[0],
    to: '0x...',
    value: etherToWei('0.1'),
  });
  
  const receipt = await waitForTxSuccess(tx);
  console.log('Transaction confirmed in block:', receipt.blockNumber);
}

if (require.main === module) {
  main().catch(console.error);
}
*/
