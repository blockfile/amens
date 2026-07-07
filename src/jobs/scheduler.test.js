'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MongoMemoryServer } = require('mongodb-memory-server');

test('pollOnce records detected manual activity and skips silently when idle', async () => {
  process.env.DRY_RUN = 'true';
  process.env.TOKEN_MINT = 'Amens111111111111111111111111111111111111';
  process.env.DRY_RUN_FEE_PER_POLL = '0'; // no simulated activity yet — we control it
  process.env.DRY_RUN_TOKENS_PER_POLL = '0';
  delete require.cache[require.resolve('../config')];
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = 'amens_test_sched';
  const db = require('../db/index');
  const repo = require('../db/repository');
  const config = require('../config');
  const scheduler = require('./scheduler');
  await db.connect();
  try {
    // Nothing detected → tick skips silently, no cycle row written.
    const p1 = await scheduler.pollOnce('poll');
    assert.strictEqual(p1.ran, false);
    assert.strictEqual(p1.reason, 'nothing new to record');
    assert.strictEqual((await repo.getCycles(10, 0)).total, 0);
    assert.strictEqual(scheduler.getState().lastDetected, 0);

    // Simulated manual activity appears → the next tick records a full cycle.
    config.dryRunFeePerPoll = 0.4;
    config.dryRunTokensPerPoll = 100000;
    const p2 = await scheduler.pollOnce('poll');
    assert.strictEqual(p2.ran, true);
    assert.strictEqual(p2.detected, 4);
    assert.strictEqual(p2.cycle.status, 'complete');
    assert.strictEqual(p2.cycle.mode, 'manual');
    assert.deepStrictEqual(p2.cycle.steps.map((s) => s.name), ['claim', 'buy', 'airdrop', 'burn']);
    assert.strictEqual((await repo.getCycles(10, 0)).total, 1);

    // Paused → poll tick refuses, but a manual trigger still works.
    scheduler.pause();
    assert.strictEqual((await scheduler.pollOnce('poll')).reason, 'paused');
    const manual = await scheduler.triggerNow();
    assert.strictEqual(manual.status, 'complete');
    scheduler.resume();

    // Manual trigger with nothing new → { skipped }.
    config.dryRunFeePerPoll = 0;
    config.dryRunTokensPerPoll = 0;
    const idle = await scheduler.triggerNow();
    assert.strictEqual(idle.skipped, true);
  } finally {
    await db.close();
    await mongod.stop();
    delete require.cache[require.resolve('../config')];
  }
});
