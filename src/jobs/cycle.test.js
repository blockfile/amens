'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MongoMemoryServer } = require('mongodb-memory-server');

test('runCycle: records detected manual claim/buy/send/burn, dedupes rescans', async () => {
  process.env.DRY_RUN = 'true';
  process.env.TOKEN_MINT = 'Amens111111111111111111111111111111111111'; // $AMENS
  process.env.REWARD_WALLET = 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52'; // the Ansem wallet
  delete require.cache[require.resolve('../config')];
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = 'amens_test_cycle';
  const db = require('../db/index');
  const repo = require('../db/repository');
  const { runCycle } = require('./cycle');
  await db.connect();
  try {
    const events = [
      { type: 'claim', signature: 'sig_claim_1', at: '2026-07-07T00:00:00.000Z', solClaimed: 0.4 },
      { type: 'buy', signature: 'sig_buy_1', at: '2026-07-07T00:00:05.000Z', tokensBought: 100000, tokensBoughtRaw: '100000000000', solSpent: 0.3 },
      { type: 'airdrop', signature: 'sig_send_1', at: '2026-07-07T00:01:00.000Z', tokensSent: 70000, tokensSentRaw: '70000000000' },
      { type: 'burn', signature: 'sig_burn_1', at: '2026-07-07T00:01:30.000Z', tokensBurned: 5000, tokensBurnedRaw: '5000000000' },
    ];

    const cycle = await runCycle(events);
    assert.strictEqual(cycle.status, 'complete');
    assert.strictEqual(cycle.mode, 'manual');
    assert.strictEqual(cycle.sol_claimed, 0.4);
    assert.strictEqual(cycle.tokens_bought, 100000);
    assert.strictEqual(cycle.tokens_burned, 5000);
    assert.deepStrictEqual(cycle.steps.map((s) => s.name), ['claim', 'buy', 'airdrop', 'burn']);

    // Every step carries the REAL on-chain signature.
    assert.ok(cycle.steps.every((s) => s.signature && s.signature.startsWith('sig_')));

    // The detected send fed the airdrops collection (GET /airdrops + summary).
    const { items } = await repo.getAirdrops(10, 0);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].recipient, process.env.REWARD_WALLET);
    assert.strictEqual(items[0].amount_ui, 70000);
    assert.strictEqual(items[0].signature, 'sig_send_1');

    // Rescan of the same signatures → skipped, no new row.
    const rerun = await runCycle(events);
    assert.strictEqual(rerun.skipped, true);
    assert.strictEqual((await repo.getCycles(10, 0)).total, 1);

    // Nothing at all → skipped silently.
    assert.strictEqual((await runCycle([])).skipped, true);

    // A lone detected send (dev sent without buying this tick) still records.
    const sendOnly = await runCycle([
      { type: 'airdrop', signature: 'sig_send_2', at: '2026-07-07T00:05:00.000Z', tokensSent: 1000, tokensSentRaw: '1000000000' },
    ]);
    assert.strictEqual(sendOnly.status, 'complete');
    assert.deepStrictEqual(sendOnly.steps.map((s) => s.name), ['airdrop']);
  } finally {
    await db.close();
    await mongod.stop();
    delete process.env.REWARD_WALLET;
    delete require.cache[require.resolve('../config')];
  }
});
