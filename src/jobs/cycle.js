'use strict';

const config = require('../config');
const repo = require('../db/repository');

/**
 * One record-only cycle. The bot does NOTHING on-chain — the dev manually
 * claims creator fees, buys $AMENS, sends to the Ansem wallet, and burns.
 * The watcher detects those transactions and this cycle records them to Mongo
 * (steps + airdrops rows) so the frontend can display everything.
 *
 * @param {Array} events detected events from watcher.scan()
 * @returns cycle row with steps, or { skipped: true } when there is nothing
 *          new to record (no cycle row is written).
 */
async function runCycle(events = []) {
  // Dedupe by on-chain signature so a crash-and-rescan can't double-record.
  const seen = new Set();
  const fresh = [];
  for (const e of events) {
    if (e.signature && !seen.has(e.signature) && (await repo.hasStepSignature(e.signature))) {
      seen.add(e.signature);
    }
    if (e.signature && seen.has(e.signature)) continue;
    fresh.push(e);
  }
  if (fresh.length === 0) return { skipped: true, reason: 'nothing new to record' };

  const id = await repo.createCycle({ dryRun: config.dryRun });
  const log = (m) => console.log(`[cycle ${id}] ${m}`);
  try {
    let solClaimed = 0;
    let tokensBought = 0;
    let tokensBurned = 0;
    let tokensSent = 0;

    for (const e of fresh) {
      if (e.type === 'claim') {
        solClaimed += e.solClaimed;
        await repo.addStep({
          cycleId: id, name: 'claim', status: 'ok', signature: e.signature,
          detail: { solClaimed: e.solClaimed, source: 'detected' },
        });
        log(`detected manual claim of ${e.solClaimed} SOL (${e.signature})`);
      } else if (e.type === 'buy') {
        tokensBought += e.tokensBought;
        await repo.addStep({
          cycleId: id, name: 'buy', status: 'ok', signature: e.signature,
          detail: { leg: 'buyback', buyMint: config.tokenMint, solSpent: e.solSpent, tokensBought: e.tokensBought, source: 'detected' },
        });
        log(`detected manual buy of ${e.tokensBought} tokens (${e.signature})`);
      } else if (e.type === 'airdrop') {
        tokensSent += e.tokensSent;
        await repo.addStep({
          cycleId: id, name: 'airdrop', status: 'ok', signature: e.signature,
          detail: { leg: 'buyback', rewardMint: config.tokenMint, recipients: 1, sent: 1, failed: 0, tokensSent: e.tokensSent, source: 'detected' },
        });
        // Also feed the airdrops collection — powers GET /airdrops and the
        // summary's buybackDistributed total.
        await repo.addAirdrop({
          cycleId: id,
          rewardMint: config.tokenMint,
          recipient: config.rewardWallet,
          amountRaw: e.tokensSentRaw ?? '0',
          amountUi: e.tokensSent,
          signature: e.signature,
          status: 'ok',
        });
        log(`detected manual send of ${e.tokensSent} to Ansem (${e.signature})`);
      } else if (e.type === 'burn') {
        tokensBurned += e.tokensBurned;
        await repo.addStep({
          cycleId: id, name: 'burn', status: 'ok', signature: e.signature,
          detail: { burnMint: config.tokenMint, tokensBurned: e.tokensBurned, burnedRaw: e.tokensBurnedRaw ?? null, source: 'detected' },
        });
        log(`detected manual burn of ${e.tokensBurned} (${e.signature})`);
      }
    }

    await repo.finishCycle(id, {
      status: 'complete',
      mode: 'manual',
      sol_claimed: solClaimed,
      tokens_bought: tokensBought,
      tokens_burned: tokensBurned,
      note: `recorded ${fresh.length} manual event(s); sent ${tokensSent}, burned ${tokensBurned}`,
    });
    return repo.getCycleWithSteps(id);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    await repo.addStep({ cycleId: id, name: 'error', status: 'failed', detail: { message } });
    await repo.finishCycle(id, { status: 'failed', error: message });
    console.log(`[cycle ${id}] FAILED: ${message}`);
    return repo.getCycleWithSteps(id);
  }
}

module.exports = { runCycle };
