'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('config exposes the AMENS flywheel defaults', () => {
  const config = require('./config');
  assert.strictEqual(config.buybackPct, 75); // % of claim → buy back $AMENS
  assert.strictEqual(config.ansemPct, 70); // % of bought tokens → Ansem
  assert.strictEqual(config.burnPct, 5); // % of bought tokens → burned
  assert.strictEqual(config.rewardWallet, 'GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52');
  assert.strictEqual(config.pollSchedule, '*/5 * * * *'); // every 5 minutes
  assert.strictEqual(config.dryRunFeePerPoll, 0.4);
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
