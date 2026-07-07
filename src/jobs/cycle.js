'use strict';

const config = require('../config');
const repo = require('../db/repository');
const { claimCreatorFees, buyToken } = require('../solana/pumpfun');
const { airdropToken } = require('../solana/airdrop');
const { burnToken } = require('../solana/burn');

/**
 * One AMENS cycle (fired by the scheduler on a fixed timer, default every
 * 5 minutes — skipped upstream when nothing is claimable):
 *   claim $AMENS creator fees (once)
 *   buy back $AMENS with BUYBACK_PCT% (75%) of the claim
 *   of the tokens bought THIS cycle:
 *     ANSEM_PCT% (70%) → REWARD_WALLET (the Ansem wallet)
 *     BURN_PCT%  (5%)  → burned on-chain (supply reduction)
 *     the rest (25%)   → stays in the operating wallet
 *   the unspent 25% of the claimed SOL also stays (marketing + tx fees)
 *
 * Safety rule: only what was bought this cycle (buy.tokensBoughtRaw) is ever
 * sent or burned — never the operating wallet's pre-existing token balance.
 */
async function runCycle() {
  const id = await repo.createCycle({ dryRun: config.dryRun });
  const log = (m) => console.log(`[cycle ${id}] ${m}`);
  try {
    const claim = await claimCreatorFees();
    await repo.addStep({ cycleId: id, name: 'claim', status: 'ok', signature: claim.signature, detail: { solClaimed: claim.solClaimed } });
    log(`claimed ${claim.solClaimed} SOL`);
    if (!(claim.solClaimed > 0)) {
      await repo.finishCycle(id, { status: 'skipped', sol_claimed: claim.solClaimed, note: 'nothing claimed' });
      return repo.getCycleWithSteps(id);
    }
    if (!config.tokenMint || !config.rewardWallet) {
      throw new Error('TOKEN_MINT ($AMENS) and REWARD_WALLET are required');
    }

    const buySol = +(claim.solClaimed * (config.buybackPct / 100)).toFixed(6);

    const buy = await buyToken(config.tokenMint, buySol);
    await repo.addStep({ cycleId: id, name: 'buy', status: 'ok', signature: buy.signature, detail: { leg: 'buyback', buyMint: config.tokenMint, solSpent: buySol, tokensBought: buy.tokensBought } });
    log(`bought back ${buy.tokensBought} AMENS with ${buySol} SOL`);

    let sentUi = 0;
    let burnedUi = 0;
    const boughtRaw = BigInt(buy.tokensBoughtRaw || '0');
    if (boughtRaw > 0n) {
      const decimals = buy.baseDecimals ?? 6;
      const uiOf = (raw) => Number(raw) / 10 ** decimals;

      // Integer shares of THIS cycle's buy: 70% → Ansem, 5% → burn, rest stays.
      const ansemRaw = (boughtRaw * BigInt(Math.round(config.ansemPct))) / 100n;
      const burnRaw = (boughtRaw * BigInt(Math.round(config.burnPct))) / 100n;

      if (ansemRaw > 0n) {
        const allocations = [{ owner: config.rewardWallet, amountRaw: ansemRaw.toString() }];
        const result = await airdropToken({ rewardMint: config.tokenMint, allocations, cycleId: id });
        sentUi = uiOf(ansemRaw);
        await repo.addStep({ cycleId: id, name: 'airdrop', status: result.failed ? 'failed' : 'ok', detail: { leg: 'buyback', rewardMint: config.tokenMint, recipients: 1, sent: result.sent, failed: result.failed, tokensSent: sentUi } });
        log(`sent ${sentUi} (${config.ansemPct}%) to ${config.rewardWallet} (sent=${result.sent} failed=${result.failed})`);
      }

      if (burnRaw > 0n) {
        const burn = await burnToken(config.tokenMint, burnRaw.toString());
        burnedUi = uiOf(burnRaw);
        await repo.addStep({ cycleId: id, name: 'burn', status: 'ok', signature: burn.signature, detail: { burnMint: config.tokenMint, tokensBurned: burnedUi, burnedRaw: burn.burnedRaw } });
        log(`burned ${burnedUi} (${config.burnPct}%)`);
      }
    }

    await repo.finishCycle(id, {
      status: 'complete',
      mode: 'buyback',
      sol_claimed: claim.solClaimed,
      sol_spent_buy: buySol,
      tokens_bought: buy.tokensBought,
      tokens_burned: burnedUi,
      note: `sent ${sentUi}, burned ${burnedUi}`,
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
