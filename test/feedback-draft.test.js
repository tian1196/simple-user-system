const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

async function fixture(t, adapter) {
  const { default: axios, AxiosError } = await import('../web/node_modules/axios/index.js')
  const previous = axios.defaults.adapter
  axios.defaults.adapter = async config => adapter(config, AxiosError)
  const { createServer } = await import('../web/node_modules/vite/dist/node/index.js')
  const vite = await createServer({ configFile: path.resolve('web/vite.site.config.ts'), logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  t.after(async () => { axios.defaults.adapter = previous; await vite.close() })
  const { pinia } = await vite.ssrLoadModule('/src/stores/index.ts')
  const { useFeedbackDraft } = await vite.ssrLoadModule('/src/stores/feedbackDraft.ts')
  const api = await vite.ssrLoadModule('/src/api/feedback.ts')
  return { draft: useFeedbackDraft(pinia), reopen: () => useFeedbackDraft(pinia), api }
}
const attachment = id => ({ id, filename: '截图.png', mime: 'image/png', size: 123 })
const submission = draft => ({ type: draft.form.type, title: draft.form.title, content: draft.form.content, contact: draft.form.contact, diagnostics_consent: draft.form.consent, attachment_ids: draft.attachments.map(a => a.id) })
const response = (config, data, status = 200) => ({ status, statusText: '', headers: {}, config, data: { data } })

test('a feedback retry after navigation reuses its key when the successful response was lost', async t => {
  const stored = new Map()
  let loseResponse = true
  const { draft, reopen, api } = await fixture(t, (config, AxiosError) => {
    assert.equal(config.url, '/feedback')
    const data = JSON.parse(config.data)
    if (!stored.has(data.request_key)) stored.set(data.request_key, { id: 'accepted-feedback', number: 'FB20261118-0001' })
    if (loseResponse) { loseResponse = false; throw new AxiosError('response lost', 'ERR_NETWORK', config) }
    return response(config, stored.get(data.request_key), 201)
  })
  draft.prepare('owner-one', '/app')
  Object.assign(draft.form, { title: '反馈重试测试', content: '提交成功但响应丢失，返回表单后继续重试。' })
  draft.attachments.push(attachment('screenshot-one'))
  const data = submission(draft)
  const key = draft.submissionKey(data)
  await assert.rejects(api.submitFeedback({ ...data, request_key: key }), error => error.code === 'NETWORK_ERROR')
  const resumed = reopen()
  resumed.prepare('owner-one', '/app/feedback')
  assert.equal(resumed.form.title, '反馈重试测试')
  assert.equal(resumed.attachments.length, 1)
  assert.equal(resumed.submissionKey(submission(resumed)), key)
  const result = await api.submitFeedback({ ...submission(resumed), request_key: resumed.submissionKey(submission(resumed)) })
  assert.equal(result.id, 'accepted-feedback')
  assert.equal(stored.size, 1, 'retrying the accepted request must not create another feedback record')
  resumed.reset()
  resumed.prepare('owner-one', '/app')
  assert.equal(resumed.form.title, '')
  assert.equal(resumed.attachments.length, 0)
  const freshKey = resumed.submissionKey(data)
  assert.notEqual(freshKey, key, 'a successfully cleared draft starts a new request')
  resumed.form.title = '私有草稿'
  resumed.prepare('owner-two', '/app')
  assert.equal(resumed.form.title, '')
  assert.notEqual(resumed.submissionKey(data), freshKey, 'another owner cannot inherit the previous retry key')
})

test('expired screenshots can be removed without losing draft text; server failures keep the attachment for retry', async t => {
  let status = 404
  const { draft } = await fixture(t, (config, AxiosError) => {
    assert.equal(config.method, 'delete')
    if (status === 204) return response(config, null, 204)
    throw new AxiosError('delete failed', 'ERR_BAD_RESPONSE', config, undefined, response(config, null, status))
  })
  draft.prepare('owner-one', '/app')
  Object.assign(draft.form, { title: '保留未提交内容', content: '截图过期后应允许移除，重新选择图片，而无需丢弃文字。' })
  draft.attachments.push(attachment('expired'))
  await draft.removeAttachment('expired')
  assert.equal(draft.attachments.length, 0)
  assert.equal(draft.form.title, '保留未提交内容')
  assert.ok(draft.form.content.includes('截图过期'))
  draft.attachments.push(attachment('retryable'))
  status = 500
  await assert.rejects(draft.removeAttachment('retryable'), error => error.status === 500)
  assert.equal(draft.attachments[0].id, 'retryable')
  status = 204
  await draft.removeAttachment('retryable')
  assert.equal(draft.attachments.length, 0)
  assert.equal(draft.form.title, '保留未提交内容')
})
