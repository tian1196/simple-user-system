const { test } = require('node:test')
const assert = require('node:assert/strict')

test('device form accepts name-only, validates real dates and preserves optional fields', async () => {
  const { validateDevice, isLedgerDate, ledgerToday } = await import('../web/site/src/utils/device-form.ts')
  const fields = { name: '设备', category: 'other', model: '', note: '', purchased_on: '', warranty_until: '' }
  assert.equal(validateDevice(fields, '2026-11-12'), '')
  assert.match(validateDevice({ ...fields, name: ' ' }), /名称/)
  assert.match(validateDevice({ ...fields, name: 'x'.repeat(81) }), /80/)
  assert.match(validateDevice({ ...fields, purchased_on: '2026-11-13' }, '2026-11-12'), /晚于今天/)
  assert.match(validateDevice({ ...fields, purchased_on: '2026-02-30' }), /有效日期/)
  assert.match(validateDevice({ ...fields, purchased_on: '2026-11-01', warranty_until: '2026-10-01' }, '2026-11-12'), /早于购买/)
  assert.equal(isLedgerDate('2024-02-29'), true)
  assert.equal(isLedgerDate('2026-02-29'), false)
  assert.match(ledgerToday(), /^\d{4}-\d{2}-\d{2}$/)
})
