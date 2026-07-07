'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  toPublicSummary,
  buildUnclaimedPayload,
  toActivityRow,
  toPublicActivityRow,
  toPublicStats,
} = require('./format');

test('buildUnclaimedPayload reports the live balance only (no threshold fields)', () => {
  const out = buildUnclaimedPayload(0.5, 150);
  assert.deepStrictEqual(Object.keys(out).sort(), ['solPriceUsd', 'unclaimedSol', 'unclaimedUsd']);
  assert.strictEqual(out.unclaimedSol, 0.5);
  assert.strictEqual(out.unclaimedUsd, 75);
  assert.strictEqual(out.solPriceUsd, 150);
  // null balance is preserved (RPC unavailable)
  assert.strictEqual(buildUnclaimedPayload(null, 150).unclaimedSol, null);
});

test('toActivityRow maps claim/buy/airdrop steps', () => {
  const buy = toActivityRow({ name: 'buy', detail: { solSpent: 0.4, leg: 'A' }, signature: 'sig', created_at: 'x' }, 100);
  assert.strictEqual(buy.type, 'Buy');
  assert.strictEqual(buy.amountSol, 0.4);

  const airdropFail = toActivityRow({ name: 'airdrop', status: 'failed', detail: {} }, 0);
  assert.strictEqual(airdropFail.status, 'Failed');
});

test('toPublicActivityRow maps buy steps', () => {
  const row = toPublicActivityRow({ name: 'buy', detail: { solSpent: 0.2, leg: 'A' }, signature: 's', created_at: '2026-06-29T00:00:00Z' }, 100);
  assert.strictEqual(row.type, 'buy');
  assert.strictEqual(row.amountSol, 0.2);
  assert.strictEqual(typeof row.usdtValue, 'number'); // never null
});

test('toPublicStats drops threshold/dev/liquidity fields', () => {
  const out = toPublicStats({
    stats: { total_sol_claimed: 12 },
    unclaimedSol: 0.5,
    operatingWallet: 'WALLET',
    market: { marketCap: 100 },
  });
  assert.strictEqual(out.totalCreatorFeesClaimed, 12);
  assert.strictEqual(out.operatingWallet, 'WALLET');
  for (const k of ['autoClaimThresholdSol', 'totalForDevTech', 'totalUsedForLiquidity', 'totalLiquidityAdded', 'devWalletAddress']) {
    assert.ok(!(k in out), `${k} should be gone`);
  }
});

test('toPublicSummary reports the buyback totals and the reward wallet', () => {
  const out = toPublicSummary({
    stats: { total_sol_claimed: 10 },
    byMint: { TROLL: { sends: 5, totalUi: 2000, holders: 1 } },
    price: 150,
    tokenMint: 'TROLL',
    rewardWallet: 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52',
    marketCapUsd: 55_620_000,
  });
  assert.strictEqual(out.creatorFeesClaimedSol, 10);
  assert.strictEqual(out.creatorFeesClaimedUsd, 1500);
  assert.strictEqual(out.buybackDistributed, 2000);
  assert.strictEqual(out.distributions, 5);
  assert.strictEqual(out.recipient, 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52');
  assert.strictEqual(out.marketCapUsd, 55_620_000);
  assert.ok(!('ansemDistributed' in out), 'ansemDistributed should be gone');
  assert.ok(!('holders' in out), 'holders should be gone (single fixed recipient)');
});

test('toPublicSummary marketCapUsd defaults to null when not provided', () => {
  const out = toPublicSummary({ stats: {}, byMint: {}, price: 0, tokenMint: 'TROLL', rewardWallet: 'W' });
  assert.strictEqual(out.marketCapUsd, null);
});

test('activity rows: claim label, amountTokens for buy/airdrop/burn', () => {
  const claim = toActivityRow({ name: 'claim', status: 'ok', detail: { solClaimed: 0.4 }, created_at: '2026-07-05T00:00:00Z' }, 150);
  assert.strictEqual(claim.type, 'Claim'); // detected manual claim

  const burnRow = toActivityRow({ name: 'burn', status: 'ok', detail: { tokensBurned: 5000 }, created_at: '2026-07-05T00:00:00Z' }, 150);
  assert.strictEqual(burnRow.type, 'Burn');

  const buy = toPublicActivityRow({ id: 1, name: 'buy', status: 'ok', detail: { solSpent: 0.75, tokensBought: 100000 }, created_at: '2026-07-05T00:00:00Z' }, 150);
  assert.strictEqual(buy.amountTokens, 100000);

  const drop = toPublicActivityRow({ id: 2, name: 'airdrop', status: 'ok', detail: { sent: 1, failed: 0, tokensSent: 70000 }, created_at: '2026-07-05T00:00:00Z' }, 150);
  assert.strictEqual(drop.amountTokens, 70000);
  assert.strictEqual(drop.status, 'completed');

  const burn = toPublicActivityRow({ id: 3, name: 'burn', status: 'ok', signature: 'burn_x', detail: { tokensBurned: 5000 }, created_at: '2026-07-05T00:00:00Z' }, 150);
  assert.strictEqual(burn.type, 'burn');
  assert.strictEqual(burn.amountTokens, 5000);
});
