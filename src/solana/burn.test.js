'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('burnToken (DRY_RUN): fakes a signature, zero amount is a no-op', async () => {
  process.env.DRY_RUN = 'true';
  delete require.cache[require.resolve('../config')];
  const { burnToken } = require('./burn');

  const burn = await burnToken('Amens111111111111111111111111111111111111', '5000000');
  assert.ok(burn.signature.startsWith('burn_'));
  assert.strictEqual(burn.burnedRaw, '5000000');
  assert.strictEqual(burn.simulated, true);

  const none = await burnToken('Amens111111111111111111111111111111111111', '0');
  assert.strictEqual(none.signature, null);
  assert.strictEqual(none.burnedRaw, '0');
});
