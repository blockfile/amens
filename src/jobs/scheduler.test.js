'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MongoMemoryServer } = require('mongodb-memory-server');

test('pollOnce claims whatever accrued and skips when the vault is empty', async () => {
  process.env.DRY_RUN = 'true';
  process.env.SIMULATE_GRADUATED = 'true';
  process.env.TOKEN_MINT = 'Amens111111111111111111111111111111111111';
  process.env.DRY_RUN_FEE_PER_POLL = '0'; // no simulated accrual — we control the vault
  delete require.cache[require.resolve('../config')];
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = 'amens_test_sched';
  const db = require('../db/index');
  const repo = require('../db/repository');
  const simvault = require('../solana/simvault');
  const scheduler = require('./scheduler');
  await db.connect();
  try {
    simvault.reset(0);

    // Empty vault → tick skips silently, no cycle row written.
    const p1 = await scheduler.pollOnce('poll');
    assert.strictEqual(p1.ran, false);
    assert.strictEqual(p1.reason, 'nothing claimable');
    assert.strictEqual((await repo.getCycles(10, 0)).total, 0, 'no cycle while vault is empty');

    // Any accrued fees → the next tick claims, buys, sends, burns.
    simvault.reset(0.1);
    const p2 = await scheduler.pollOnce('poll');
    assert.strictEqual(p2.ran, true);
    assert.strictEqual(p2.cycle.status, 'complete');
    const names = p2.cycle.steps.map((s) => s.name);
    assert.deepStrictEqual(names, ['claim', 'buy', 'airdrop', 'burn']);
    assert.strictEqual((await repo.getCycles(10, 0)).total, 1);
  } finally {
    await db.close();
    await mongod.stop();
    delete require.cache[require.resolve('../config')];
  }
});
