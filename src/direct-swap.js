// src/cli/swap.ts
#!/usr/bin/env node

/**
 * 🦄 WETH → DAI Swap CLI
 * 
 * A production-ready command-line tool that executes token swaps using the 0x Protocol.
 * Features: Auto-approval, balance tracking, slippage protection, and comprehensive error handling.
 * 
 * @example
 * $ swap-weth-dai --amount 0.5 --network mainnet
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { BigNumber } from 'bignumber.js';
import { config } from 'dotenv';
import { createWeb3, etherToWei, weiToEther, waitForTxSuccess, createQueryString } from '../lib/web3';
import { fetchQuote, executeSwap } from '../lib/zero-x';
import { getContract, WETH_ABI, ERC20_ABI } from '../lib/contracts';
import { validateConfig, validateAmount } from '../lib/validation';
import { printSwapSummary, printSuccess, printError, printInfo } from '../lib/logger';

config(); // Load .env file

// ========== CONFIGURATION ==========

const DEFAULTS = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083c756Cc2',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  SLIPPAGE_PERCENTAGE: 1, // 1% slippage tolerance
};

// ========== CLI SETUP ==========

const program = new Command();

program
  .name('swap-weth-dai')
  .description('Swap WETH for DAI using 0x Protocol')
  .version('1.0.0')
  .option('-a, --amount <number>', 'Amount of WETH to sell', '0.1')
  .option('-w, --weth <address>', 'WETH contract address', DEFAULTS.WETH)
  .option('-d, --dai <address>', 'DAI contract address', DEFAULTS.DAI)
  .option('-s, --slippage <number>', 'Slippage tolerance %', '1')
  .option('--forked', 'Running on a forked network (disables gas estimation)')
  .parse();

// ========== MAIN EXECUTION ==========

async function run() {
  const opts = program.opts();
  
  // Validate environment and inputs
  validateConfig();
  validateAmount(opts.amount);
  
  const web3 = createWeb3();
  const [signer] = await web3.eth.getAccounts();
  
  printInfo('Initializing swap...', { signer, amount: opts.amount });
  
  // Get contracts
  const weth = getContract(web3, WETH_ABI, opts.weth);
  const dai = getContract(web3, ERC20_ABI, opts.dai);
  
  // Record starting balance
  const daiBalanceBefore = await dai.methods.balanceOf(signer).call();
  
  // Mint WETH if needed
  await ensureWethBalance(weth, signer, opts.amount);
  
  // Fetch quote
  const quote = await fetchQuote({
    sellToken: 'WETH',
    buyToken: 'DAI',
    sellAmount: etherToWei(opts.amount),
    takerAddress: opts.forked ? undefined : signer,
    slippagePercentage: opts.slippage,
  });
  
  printSwapSummary(quote);
  
  // Approve WETH spending
  await approveToken(weth, signer, quote.allowanceTarget, quote.sellAmount);
  
  // Execute swap
  const receipt = await executeSwap(web3, quote, signer, opts.forked);
  
  // Verify results
  await verifySwapResults(dai, signer, daiBalanceBefore, quote);
}

// ========== HELPER FUNCTIONS ==========

async function ensureWethBalance(weth: any, signer: string, amount: string) {
  const wethBalance = await weth.methods.balanceOf(signer).call();
  const requiredWei = etherToWei(amount);
  
  if (new BigNumber(wethBalance).lt(requiredWei)) {
    printInfo(`Minting ${amount} WETH from ETH...`);
    
    await waitForTxSuccess(
      weth.methods.deposit().send({
        value: requiredWei,
        from: signer,
      })
    );
    
    printInfo(`✅ WETH minted successfully`);
  } else {
    printInfo(`Sufficient WETH balance detected: ${weiToEther(wethBalance)}`);
  }
}

async function approveToken(token: any, signer: string, spender: string, amount: string) {
  printInfo('Approproving token spend...');
  
  const currentAllowance = await token.methods.allowance(signer, spender).call();
  
  if (new BigNumber(currentAllowance).lt(amount)) {
    await waitForTxSuccess(
      token.methods.approve(spender, amount).send({ from: signer })
    );
    printInfo('✅ Approval granted');
  } else {
    printInfo('✅ Sufficient allowance already exists');
  }
}

async function verifySwapResults(dai: any, signer: string, balanceBefore: string, quote: any) {
  const balanceAfter = await dai.methods.balanceOf(signer).call();
  const received = weiToEther(new BigNumber(balanceAfter).minus(balanceBefore));
  const expected = weiToEther(quote.buyAmount);
  
  const slippage = new BigNumber(expected).minus(received).div(expected).times(100);
  
  printSuccess({
    sold: weiToEther(quote.sellAmount),
    received,
    expected,
    slippage: slippage.toFixed(4),
    txHash: quote.id,
  });
}

// ========== ERROR HANDLING ==========

run().catch((error) => {
  printError(error);
  process.exit(1);
});
