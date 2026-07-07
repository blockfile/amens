'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MongoMemoryServer } = require('mongodb-memory-server');

test('meta store + step signature dedupe', async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = 'amens_test_meta';
  const db = require('./index');
  const repo = require('./repository');
  await db.connect();
  try {
    // meta: missing -> null, set -> get roundtrip, overwrite wins
    assert.strictEqual(await repo.getMeta('watch_cursor'), null);
    await repo.setMeta('watch_cursor', 'sig_abc');
    assert.strictEqual(await repo.getMeta('watch_cursor'), 'sig_abc');
    await repo.setMeta('watch_cursor', 'sig_def');
    assert.strictEqual(await repo.getMeta('watch_cursor'), 'sig_def');

    // signature dedupe: unknown -> false, recorded step -> true, null-safe
    assert.strictEqual(await repo.hasStepSignature('sig_tx_1'), false);
    const cycleId = await repo.createCycle({ dryRun: true });
    await repo.addStep({ cycleId, name: 'buy', status: 'ok', signature: 'sig_tx_1', detail: {} });
    assert.strictEqual(await repo.hasStepSignature('sig_tx_1'), true);
    assert.strictEqual(await repo.hasStepSignature(null), false);
  } finally {
    await db.close();
    await mongod.stop();
  }
});
