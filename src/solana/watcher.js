'use strict';

const config = require('../config');
const repo = require('../db/repository');
const { connection, wallet } = require('./connection');

// pump.fun program family (mainnet) — a tx touching any of these with a positive
// SOL delta and no token movement is a creator-fee claim. Addresses match
// pumpsdk/package/src/idl/{pump,pump_amm,pump_fees}.json.
const PUMP_PROGRAM_IDS = new Set([
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // pump (bonding curve)
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // pump AMM (PumpSwap)
  'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ', // pump fees
]);

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS = 1e9;

// One owner's total balance (base units) for `mint` across a token-balance list.
function tokenTotal(list, owner, mint) {
  let total = 0n;
  for (const b of list || []) {
    if (b.owner === owner && b.mint === mint) total += BigInt(b.uiTokenAmount.amount);
  }
  return total;
}

// Net supply-side delta for `mint` across ALL touched accounts. A plain transfer
// sums to 0; a burn sums negative (tokens left circulation).
function mintTotalDelta(tx, mint) {
  let total = 0n;
  for (const b of tx.meta.postTokenBalances || []) {
    if (b.mint === mint) total += BigInt(b.uiTokenAmount.amount);
  }
  for (const b of tx.meta.preTokenBalances || []) {
    if (b.mint === mint) total -= BigInt(b.uiTokenAmount.amount);
  }
  return total;
}

function tokenDecimals(tx, mint) {
  const all = [...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])];
  const hit = all.find((b) => b.mint === mint);
  return hit ? hit.uiTokenAmount.decimals : 6;
}

/**
 * Classify one parsed wallet transaction into the dev's manual-activity events.
 * Returns an ARRAY (one tx can both send and burn):
 *   wallet token balance up                  → buy   (swap from any venue)
 *   Ansem wallet token balance up            → airdrop (manual send to Ansem)
 *   mint supply-side total down              → burn  (manual on-chain burn)
 *   pump program + SOL up, no token movement → claim
 *   anything else / failed tx                → []
 */
function classifyTransaction(tx, { walletAddress, tokenMint, rewardWallet }) {
  if (!tx || !tx.meta || tx.meta.err) return [];
  const keys = tx.transaction.message.accountKeys.map((k) => String(k.pubkey ?? k));
  const walletIx = keys.indexOf(walletAddress);
  if (walletIx === -1) return [];

  const signature = tx.transaction.signatures[0];
  const at = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
  const decimals = tokenDecimals(tx, tokenMint);
  const uiOf = (raw) => Number(raw) / 10 ** decimals;

  const walletDelta =
    tokenTotal(tx.meta.postTokenBalances, walletAddress, tokenMint) -
    tokenTotal(tx.meta.preTokenBalances, walletAddress, tokenMint);
  // Net SOL movement = native lamports + WSOL (AMM swaps settle in WSOL).
  const netLamports =
    BigInt(tx.meta.postBalances[walletIx]) - BigInt(tx.meta.preBalances[walletIx]) +
    tokenTotal(tx.meta.postTokenBalances, walletAddress, WSOL_MINT) -
    tokenTotal(tx.meta.preTokenBalances, walletAddress, WSOL_MINT);

  const events = [];

  if (walletDelta > 0n) {
    // Tokens came IN: the dev's manual buy (or an incoming transfer).
    events.push({
      type: 'buy',
      signature,
      at,
      tokensBoughtRaw: walletDelta.toString(),
      tokensBought: uiOf(walletDelta),
      solSpent: netLamports < 0n ? Number(-netLamports) / LAMPORTS : 0,
    });
  } else if (walletDelta < 0n) {
    // Tokens went OUT: a manual send to Ansem and/or a manual burn.
    const ansemDelta =
      tokenTotal(tx.meta.postTokenBalances, rewardWallet, tokenMint) -
      tokenTotal(tx.meta.preTokenBalances, rewardWallet, tokenMint);
    if (ansemDelta > 0n) {
      events.push({
        type: 'airdrop',
        signature,
        at,
        tokensSentRaw: ansemDelta.toString(),
        tokensSent: uiOf(ansemDelta),
      });
    }
    const supplyDelta = mintTotalDelta(tx, tokenMint);
    if (supplyDelta < 0n) {
      events.push({
        type: 'burn',
        signature,
        at,
        tokensBurnedRaw: (-supplyDelta).toString(),
        tokensBurned: uiOf(-supplyDelta),
      });
    }
    // Transfers to any other wallet are intentionally not recorded.
  } else if (netLamports > 0n && keys.some((k) => PUMP_PROGRAM_IDS.has(k))) {
    events.push({ type: 'claim', signature, at, solClaimed: Number(netLamports) / LAMPORTS });
  }

  return events;
}

const CURSOR_KEY = 'watch_cursor';

function fakeSig(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Scan the operating wallet for transactions newer than the stored cursor and
 * classify them. Returns { events, cursor }; the caller records the events,
 * THEN calls commitCursor(cursor) — signature dedupe covers the crash window.
 * First live run initializes the cursor to the newest signature: no backfill.
 *
 * DRY_RUN: emits one full simulated manual sequence per tick (claim → buy →
 * send ANSEM_PCT% to Ansem → burn BURN_PCT%) — no RPC.
 */
async function scan() {
  if (config.dryRun) {
    const events = [];
    const now = () => new Date().toISOString();
    const fee = config.dryRunFeePerPoll;
    const tokens = config.dryRunTokensPerPoll;
    if (fee > 0) {
      events.push({ type: 'claim', signature: fakeSig('claim'), at: now(), solClaimed: fee });
    }
    if (tokens > 0) {
      const rawOf = (ui) => String(Math.round(ui * 1e6));
      const sent = +(tokens * (config.ansemPct / 100)).toFixed(2);
      const burned = +(tokens * (config.burnPct / 100)).toFixed(2);
      events.push({
        type: 'buy',
        signature: fakeSig('buy'),
        at: now(),
        tokensBought: tokens,
        tokensBoughtRaw: rawOf(tokens),
        solSpent: +(fee * (config.buybackPct / 100)).toFixed(6),
      });
      events.push({ type: 'airdrop', signature: fakeSig('send'), at: now(), tokensSent: sent, tokensSentRaw: rawOf(sent) });
      events.push({ type: 'burn', signature: fakeSig('burn'), at: now(), tokensBurned: burned, tokensBurnedRaw: rawOf(burned) });
    }
    return { events, cursor: null };
  }

  const walletAddress = wallet.publicKey.toBase58();
  const until = await repo.getMeta(CURSOR_KEY);
  const sigInfos = await connection.getSignaturesForAddress(
    wallet.publicKey,
    { limit: config.watchMaxTxPerScan, ...(until ? { until } : {}) },
    'confirmed'
  );
  if (sigInfos.length === 0) return { events: [], cursor: until };

  const newest = sigInfos[0].signature;
  if (!until) return { events: [], cursor: newest }; // first run: skip history

  const events = [];
  for (const info of sigInfos.reverse()) { // oldest → newest
    if (info.err) continue;
    let parsed = null;
    try {
      parsed = await connection.getParsedTransaction(info.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
    } catch (err) {
      console.log(`[watcher] could not fetch ${info.signature}: ${err.message}`);
      continue;
    }
    if (!parsed) continue;
    events.push(
      ...classifyTransaction(parsed, {
        walletAddress,
        tokenMint: config.tokenMint,
        rewardWallet: config.rewardWallet,
      })
    );
  }
  return { events, cursor: newest };
}

async function commitCursor(cursor) {
  if (cursor) await repo.setMeta(CURSOR_KEY, cursor);
}

module.exports = { scan, commitCursor, classifyTransaction, PUMP_PROGRAM_IDS, CURSOR_KEY };
