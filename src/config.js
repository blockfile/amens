'use strict';

require('dotenv').config();

const { Keypair } = require('@solana/web3.js');
// bs58 v6 is ESM-only; under CommonJS require() the API is on `.default`.
const bs58lib = require('bs58');
const bs58 = bs58lib.default || bs58lib;

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function num(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const DRY_RUN = bool(process.env.DRY_RUN, true);

/**
 * Load the signing wallet.
 * Accepts either a base58 secret key or a JSON array of bytes.
 * In DRY_RUN with no key configured, an ephemeral keypair is generated so the
 * server runs out of the box (no funds are ever touched in dry run).
 */
function loadWallet() {
  const raw = process.env.WALLET_PRIVATE_KEY;
  if (!raw) {
    if (!DRY_RUN) {
      throw new Error('WALLET_PRIVATE_KEY is required when DRY_RUN=false');
    }
    return { keypair: Keypair.generate(), ephemeral: true };
  }
  try {
    if (raw.trim().startsWith('[')) {
      const bytes = Uint8Array.from(JSON.parse(raw));
      return { keypair: Keypair.fromSecretKey(bytes), ephemeral: false };
    }
    return { keypair: Keypair.fromSecretKey(bs58.decode(raw.trim())), ephemeral: false };
  } catch (err) {
    throw new Error(`Could not parse WALLET_PRIVATE_KEY: ${err.message}`);
  }
}

const { keypair: wallet, ephemeral: walletIsEphemeral } = loadWallet();

const config = {
  port: num(process.env.PORT, 3000),
  dryRun: DRY_RUN,

  rpcUrl: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',

  wallet,
  walletIsEphemeral,

  // Target token ($AMENS) + optionally its PumpSwap pool
  tokenMint: process.env.TOKEN_MINT || null,
  pumpswapPoolId: process.env.PUMPSWAP_POOL_ID || null,

  // On-chain execution (live mode only)
  slippagePct: num(process.env.SLIPPAGE_PCT, 5), // PumpSwap AMM slippage, percent
  curveSlippagePct: num(process.env.CURVE_SLIPPAGE_PCT, 5), // bonding-curve buy slippage, percent
  priorityFeeMicroLamports: num(process.env.PRIORITY_FEE_MICROLAMPORTS, 50000),
  computeUnitLimit: num(process.env.COMPUTE_UNIT_LIMIT, 200000),

  // DRY_RUN-only: simulate a graduated token to exercise the post-bond path.
  simulateGraduated: bool(process.env.SIMULATE_GRADUATED, false),

  // Jupiter aggregator — fallback route when the token has no pump.fun bonding
  // curve or canonical PumpSwap pool. Free lite-api needs no key.
  jupiterApi: process.env.JUPITER_API || 'https://lite-api.jup.ag/swap/v1',
  jupiterApiKey: process.env.JUPITER_API_KEY || null,
  jupiterPriorityFeeLamports: num(process.env.JUPITER_PRIORITY_FEE_LAMPORTS, 1000000),

  // Schedule — a tick runs on this timer (default every minute): scan the wallet
  // for the dev's manual claim/buy/send/burn transactions and record them.
  pollSchedule: process.env.POLL_SCHEDULE || '* * * * *',
  // DRY_RUN only: simulated manual activity per tick (so cycles have content).
  dryRunFeePerPoll: num(process.env.DRY_RUN_FEE_PER_POLL, 0.4), // simulated manual claim, SOL
  dryRunTokensPerPoll: num(process.env.DRY_RUN_TOKENS_PER_POLL, 100000), // simulated manual buy, tokens

  // Watcher — max transactions fetched+parsed per tick.
  watchMaxTxPerScan: num(process.env.WATCH_MAX_TX_PER_SCAN, 50),

  // The AMENS tokenomics story (the DEV executes it manually; the bot only
  // watches and records): BUYBACK_PCT% of each claim buys back $AMENS; of the
  // tokens bought, ANSEM_PCT% goes to REWARD_WALLET (the Ansem wallet) and
  // BURN_PCT% is burned. Used for the status display + dry-run simulation.
  buybackPct: num(process.env.BUYBACK_PCT, 75), // % of claim → buy back $AMENS
  ansemPct: num(process.env.ANSEM_PCT, 70), // % of bought tokens → Ansem
  burnPct: num(process.env.BURN_PCT, 5), // % of bought tokens → burned
  rewardWallet: process.env.REWARD_WALLET || 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52', // the Ansem wallet
  airdropBatchSize: num(process.env.AIRDROP_BATCH_SIZE, 8),

  // Storage (MongoDB)
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGODB_DB || 'amens',

  // CORS allowlist (comma-separated). Default: localhost dev origins.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Secret protecting the POST control endpoints. Blank = open (dev); set in prod.
  apiKey: process.env.API_KEY || null,
};

module.exports = config;
