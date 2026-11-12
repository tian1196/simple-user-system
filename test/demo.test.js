const { test } = require('node:test')
const assert = require('node:assert/strict')

test('demo data is isolated, due list includes overdue and only upcoming warranties', async () => {
  const { createDemoDevices, demoDueItems, demoWarrantyLabel } = await import('../web/site/src/data/demo.ts')
  const first = createDemoDevices()
  first[0].plans[0].title = 'changed'
  const devices = createDemoDevices()
  assert.equal(devices[0].plans[0].title, '滤芯更换')
  const items = demoDueItems(devices)
  assert.deepEqual(items.map(item => item.dueOn), ['2026-11-02', '2026-11-13', '2026-11-17'])
  assert.equal(demoWarrantyLabel('2025-06-12'), '保修已到期')
  assert.equal(demoWarrantyLabel(''), '保修日期未填写')
})

test('demo calendar excludes overdue, escapes event titles and labels sample data', async () => {
  const { createDemoDevices, demoCalendar } = await import('../web/site/src/data/demo.ts')
  const devices = createDemoDevices()
  devices[2].name = '设备,测试;换行\n内容'
  const calendar = demoCalendar(devices)
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 2)
  assert.doesNotMatch(calendar, /DTSTART;VALUE=DATE:20261102/)
  assert.match(calendar, /DTSTART;VALUE=DATE:20261113/)
  assert.ok(calendar.includes('设备\\,测试\\;换行\\n内容'))
  assert.match(calendar, /合成演示数据/)
  assert.ok(calendar.endsWith('END:VCALENDAR\r\n'))
})
