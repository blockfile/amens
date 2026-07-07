'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('config exposes the AMENS watcher defaults', () => {
  const config = require('./config');
  assert.strictEqual(config.buybackPct, 75); // % of claim → buy back $AMENS (dev, manual)
  assert.strictEqual(config.ansemPct, 70); // % of bought tokens → Ansem (dev, manual)
  assert.strictEqual(config.burnPct, 5); // % of bought tokens → burned (dev, manual)
  assert.strictEqual(config.rewardWallet, 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52');
  assert.strictEqual(config.pollSchedule, '* * * * *'); // scan every minute
  assert.strictEqual(config.watchMaxTxPerScan, 50);
  assert.strictEqual(config.dryRunFeePerPoll, 0.4);
  assert.strictEqual(config.dryRunTokensPerPoll, 100000);
  assert.strictEqual(config.airdropBatchSize, 8);
  assert.strictEqual(config.mongoDb, 'amens');
});

test('config.rewardWallet is overridable from env', () => {
  delete require.cache[require.resolve('./config')];
  process.env.REWARD_WALLET = 'Custom111111111111111111111111111111111111';
  const config = require('./config');
  assert.strictEqual(config.rewardWallet, 'Custom111111111111111111111111111111111111');
  delete process.env.REWARD_WALLET;
  delete require.cache[require.resolve('./config')];
});
