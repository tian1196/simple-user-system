const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { migrateReminders } = require('../server/reminder-migration')
const { migrateFeedback } = require('../server/feedback-migration')
const { createFeedback } = require('../server/feedback')
const { imageType } = require('../server/feedback-images')
const access = require('../server/permissions')
const image = ext => fs.readFileSync(`test/fixtures/feedback/screenshot.${ext}`)
function fixture(t, upgrade = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-feedback-unit-'))
  const filename = path.join(dir, 'test.sqlite'); const db = new DatabaseSync(filename)
  db.exec(fs.readFileSync('migrations/001_initial.sql','utf8'))
  db.exec("INSERT INTO users(id,username,role) VALUES('u1','feedback_one','user'),('u2','feedback_two','user'),('admin','admin_test','admin')")
  migrateReminders(db, filename)
  const backup = upgrade ? migrateFeedback(db, filename) : null
  const fail = (status, code, message) => Object.assign(new Error(message), { status, code })
  const api = upgrade ? createFeedback(db, { filename, fail, assertWrites: () => {}, audit: () => {} }) : null
  t.after(() => { api?.dispose(); db.close(); fs.rmSync(dir, {recursive:true,force:true}) })
  return {db,api,filename,dir,backup}
}
const input = (extra = {}) => ({ type:'issue',title:'手机导出提示建议',content:'手机上下载日历文件后没有导入操作提示，希望可以完善。',contact:'',request_key:randomUUID(),attachment_ids:[],...extra })

test('feedback migration preserves users, snapshots WAL and rolls back an incompatible upgrade', t => {
  const f=fixture(t,false)
  const before=f.db.prepare('SELECT * FROM users ORDER BY id').all()
  const snapshot=migrateFeedback(f.db,f.filename)
  const copy=new DatabaseSync(snapshot,{readOnly:true})
  assert.equal(copy.prepare('PRAGMA user_version').get().user_version,2)
  assert.deepEqual(copy.prepare('SELECT * FROM users ORDER BY id').all(),before);copy.close()
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,3)
  assert.equal(migrateFeedback(f.db,f.filename),null)
  const broken=fixture(t,false)
  broken.db.exec('CREATE TABLE feedback(unexpected TEXT)')
  assert.throws(()=>migrateFeedback(broken.db,broken.filename),/already exists/)
  assert.equal(broken.db.prepare('PRAGMA user_version').get().user_version,2)
  assert.equal(broken.db.prepare('SELECT count(*) n FROM users').get().n,3)
})

test('screenshots validate actual formats, enforce ownership, count and expiration, and support upload retries', t => {
  const {api,db}=fixture(t)
  for(const [ext,mime] of [['png','image/png'],['jpg','image/jpeg'],['webp','image/webp']]) assert.equal(imageType(image(ext)),mime)
  assert.equal(imageType(Buffer.from('<svg onload="alert(1)"></svg>')),null)
  assert.throws(()=>api.upload('u1',image('png'),'image/jpeg','wrong.jpg'),e=>e.code==='ATTACHMENT_TYPE')
  assert.throws(()=>api.upload('u1',Buffer.alloc(5*1024*1024+1),'image/png','large.png'),e=>e.status===413)
  const a=api.upload('u1',image('png'),'image/png','../截图.png','upload-retry-001')
  assert.equal(a.id,api.upload('u1',image('png'),'image/png','again.png','upload-retry-001').id)
  assert.equal(a.filename.includes('/'),false)
  assert.throws(()=>api.upload('u1',image('jpg'),'image/jpeg','other.jpg','upload-retry-001'),e=>e.status===409)
  assert.throws(()=>api.readAttachment('u2',a.id),e=>e.status===404)
  assert.throws(()=>api.readAttachment('admin',a.id,true),e=>e.status===404)
  assert.throws(()=>api.removeUpload('u2',a.id),e=>e.status===404)
  api.upload('u1',image('jpg'),'image/jpeg','j.jpg')
  api.upload('u1',image('webp'),'image/webp','w.webp')
  assert.throws(()=>api.upload('u1',image('png'),'image/png','p.png'),e=>e.code==='ATTACHMENT_LIMIT')
  const file=api.readAttachment('u1',a.id).location
  assert.equal(fs.statSync(file).mode&0o777,0o600)
  db.prepare('UPDATE feedback_attachments SET created_at=? WHERE id=?').run(Date.now()-86400001,a.id)
  api.cleanup()
  assert.equal(fs.existsSync(file),false)
  assert.equal(db.prepare('SELECT count(*) n FROM feedback_attachments').get().n,2)
})

test('feedback handling keeps internal information private, uses version checks and exports portable screenshots', t => {
  const {api,db}=fixture(t)
  const a=api.upload('u1',image('png'),'image/png','截图.png')
  const request=input({attachment_ids:[a.id],contact:'仅供跟进',diagnostics_consent:true,diagnostics:{page_path:'/app',browser:'QA browser'}})
  const created=api.submit('u1',request)
  assert.match(created.number,/^FB\d{8}-\d+$/)
  assert.equal(api.submit('u1',request).id,created.id)
  assert.throws(()=>api.submit('u1',{...request,title:'已变更的标题'}),e=>e.code==='DUPLICATE_REQUEST')
  assert.throws(()=>api.detail('u2',created.id),e=>e.status===404)
  assert.throws(()=>api.submit('u2',input({attachment_ids:[a.id]})),e=>e.code==='ATTACHMENT_EXPIRED')
  assert.throws(()=>api.removeUpload('u1',a.id),e=>e.status===404)
  const changed=api.update('admin',created.id,{status:'processing',reply:'已收到，正在排查。',internal_note:'SECRET_ONLY_ADMIN',version:created.version},{requestId:randomUUID()})
  assert.equal(changed.history.length,1)
  assert.equal(changed.history[0].before.status,'pending')
  assert.throws(()=>api.update('admin',created.id,{status:'resolved',reply:'旧草稿',internal_note:'',version:created.version},{}),e=>e.status===409)
  const own=api.detail('u1',created.id)
  assert.equal(own.reply,'已收到，正在排查。')
  assert.equal(JSON.stringify(own).includes('SECRET_ONLY_ADMIN'),false)
  assert.equal('history' in own,false)
  const exported=api.exportUser('u1')
  assert.equal(exported[0].attachments[0].content_base64,image('png').toString('base64'))
  assert.equal(JSON.stringify(exported).includes('SECRET_ONLY_ADMIN'),false)
  const ids=api.userFiles('u1'); const file=api.readAttachment('u1',a.id).location
  db.prepare("DELETE FROM users WHERE id='u1'").run();api.purgeFiles(ids)
  assert.equal(fs.existsSync(file),false)
  assert.equal(db.prepare('SELECT count(*) n FROM feedback_history').get().n,0)
  assert.equal(db.prepare('SELECT count(*) n FROM feedback_attachments').get().n,0)
})

test('feedback fields, consent, rate limits, search escaping and Shanghai date filters are enforced', t => {
  const {api,db}=fixture(t)
  assert.throws(()=>api.submit('u1',input({content:'太短'})),e=>e.status===400)
  assert.throws(()=>api.submit('u1',input({title:' '})),e=>e.status===400)
  assert.throws(()=>api.submit('u1',input({contact:'a'.repeat(129)})),e=>e.status===400)
  assert.throws(()=>api.submit('u1',input({diagnostics:{page_path:'/app'}})),e=>e.status===400)
  assert.throws(()=>api.submit('u1',input({diagnostics_consent:true,diagnostics:{page_path:'/app?token=private'}})),e=>e.status===400)
  const record=api.submit('u1',input({title:'100% 真实反馈 _ <script>文本</script>'}))
  db.prepare('UPDATE feedback SET created_at=? WHERE id=?').run(Date.parse('2026-11-13T23:59:59+08:00'),record.id)
  assert.equal(api.list(null,{from:'2026-11-13',to:'2026-11-13'},true).total,1)
  assert.equal(api.list(null,{from:'2026-11-14',to:'2026-11-14'},true).total,0)
  assert.equal(api.list(null,{q:'%'},true).total,1)
  assert.equal(api.list(null,{q:'not-present'},true).total,0)
  assert.throws(()=>api.list(null,{from:'2026-11-15',to:'2026-11-13'},true),e=>e.status===400)
  for(let i=0;i<10;i++)api.submit('u1',input())
  assert.throws(()=>api.submit('u1',input()),e=>e.status===429)
  assert.equal(api.list('u2').total,0)
  assert.equal(access.hasPermission('admin','feedback.manage'),true)
  assert.equal(access.hasPermission('operator','feedback.manage'),true)
  for(const role of ['user','support','auditor','partner']) assert.equal(access.hasPermission(role,'feedback.manage'),false)
})

test('real feedback APIs isolate user/admin cookies, preserve replies across restart, and clean files on account deletion', {timeout:30000}, async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-feedback-http-'))
  const env={...process.env,DATABASE_PATH:path.join(dir,'db.sqlite'),HOST:'127.0.0.1',PORT:'32001',CAPTCHA_DEBUG:'1'}
  const run=file=>spawnSync(process.execPath,[file],{env,encoding:'utf8'})
  assert.equal(run('scripts/db-init.js').status,0)
  const invite=run('scripts/create-invite.js').stdout.match(/：([^\n]+)/)[1]
  const seed=new DatabaseSync(env.DATABASE_PATH)
  const bcrypt=require('bcryptjs')
  for(const role of ['admin','operator','support']){
    seed.prepare('INSERT INTO users(id,username,role) VALUES(?,?,?)').run(role,role+'_qa',role)
    seed.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_key,password_hash) VALUES(?,?,'password',?,?)").run(role+'-auth',role,role+'_qa',bcrypt.hashSync('feedback-test-password',4))
  }seed.close()
  let child;let cookie=''
  async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}}
  async function start(){child=spawn(process.execPath,['server/index.js'],{env,stdio:['ignore','pipe','pipe']});for await(const chunk of child.stdout)if(chunk.toString().includes('设备台账已挂'))return;throw Error('server failed')}
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})})
  await start()
  async function req(route,method='GET',data,headers={}){
    const res=await fetch('http://127.0.0.1:32001/api/v1'+route,{method,headers:{Cookie:cookie,'Content-Type':'application/json',...headers},body:data===undefined?undefined:Buffer.isBuffer(data)?data:JSON.stringify(data)})
    const body=res.status===204?null:res.headers.get('content-type')?.includes('application/json')?await res.json():Buffer.from(await res.arrayBuffer())
    return {res,status:res.status,data:body?.data,body}
  }
  async function register(username){const r=await req('/auth/register','POST',{username,password:'feedback-test-password',invite_code:invite,policy_version:'2026-11-05'});assert.equal(r.status,201);return r.res.headers.get('set-cookie').split(';')[0]}
  async function adminLogin(role){cookie='';const challenge=(await req('/admin/auth/captcha')).data;const result=await req('/admin/auth/login','POST',{username:role+'_qa',password:'feedback-test-password',captcha_id:challenge.captcha_id,captcha_text:challenge.captcha_text});assert.equal(result.status,200);cookie=result.res.headers.get('set-cookie').split(';')[0];return cookie}
  assert.equal((await req('/feedback')).status,401)
  const userCookie=await register('feedback_http_one');cookie=userCookie
  assert.equal((await req('/feedback?from[]=2026-11-18')).status,400)
  assert.equal((await req('/feedback?page[]=1')).status,400)
  const brokenJpeg=Buffer.alloc(26,255);brokenJpeg[1]=216;brokenJpeg[25]=217
  assert.equal((await req('/feedback/attachments','POST',brokenJpeg,{'Content-Type':'image/jpeg'})).status,400)
  const upload=await req('/feedback/attachments','POST',image('png'),{'Content-Type':'image/png','X-File-Name':encodeURIComponent('截图.png'),'X-Upload-Key':'http-upload-key-001'})
  assert.equal(upload.status,201,JSON.stringify(upload.body))
  assert.equal((await req('/feedback/attachments','POST',Buffer.alloc(5*1024*1024+1),{'Content-Type':'image/png'})).status,413)
  const a=upload.data
  const photo=await req('/feedback/attachments/'+a.id)
  assert.equal(photo.status,200);assert.equal(photo.res.headers.get('x-content-type-options'),'nosniff');assert.ok(photo.body.equals(image('png')))
  assert.equal((await req('/feedback','POST',input(),{Origin:'https://evil.example'})).status,403)
  const submitted=await req('/feedback','POST',input({attachment_ids:[a.id]}))
  assert.equal(submitted.status,201,JSON.stringify(submitted.body))
  const id=submitted.data.id
  const otherCookie=await register('feedback_http_two');cookie=otherCookie
  assert.equal((await req('/feedback/'+id)).status,404)
  assert.equal((await req('/feedback/attachments/'+a.id)).status,404)
  assert.equal((await req('/admin/feedback')).status,401)
  cookie=userCookie;assert.equal((await req('/admin/feedback')).status,401)
  const adminCookie=await adminLogin('admin')
  assert.equal((await req('/feedback')).status,401)
  assert.equal((await req('/admin/feedback')).data.total,1)
  assert.equal((await req('/admin/feedback/attachments/'+a.id)).status,200)
  const updated=await req('/admin/feedback/'+id,'PATCH',{version:1,status:'resolved',reply:'问题已修复，感谢反馈。',internal_note:'INTERNAL_HTTP_SECRET'})
  assert.equal(updated.status,200)
  assert.equal(updated.data.history.length,1)
  assert.equal((await req('/admin/feedback/'+id,'PATCH',{version:1,status:'pending',reply:'旧回复',internal_note:''})).status,409)
  await adminLogin('operator');assert.equal((await req('/admin/feedback/'+id)).status,200)
  await adminLogin('support');assert.equal((await req('/admin/feedback')).status,403);assert.equal((await req('/admin/feedback/attachments/'+a.id)).status,403)
  await stop();await start();cookie=userCookie
  const mine=(await req('/feedback/'+id)).data
  assert.equal(mine.reply,'问题已修复，感谢反馈。');assert.equal(JSON.stringify(mine).includes('INTERNAL_HTTP_SECRET'),false)
  assert.equal((await req('/auth/reauth','POST',{password:'feedback-test-password'})).status,200)
  const exported=(await req('/exports/account')).data
  assert.equal(exported.feedback[0].attachments[0].content_base64,image('png').toString('base64'))
  assert.equal(JSON.stringify(exported).includes('INTERNAL_HTTP_SECRET'),false)
  const file=path.join(dir,'feedback-attachments',a.id+'.bin')
  assert.equal((await req('/me','DELETE',{confirm_username:'feedback_http_one'})).status,204)
  assert.equal(fs.existsSync(file),false)
  cookie=adminCookie;assert.equal((await req('/admin/feedback/'+id)).status,404)
})

test('malformed image headers are rejected without crashing or accepting fake WebP frames', t => {
  const { api } = fixture(t)
  const jpeg = Buffer.alloc(26, 255); jpeg[1] = 216; jpeg[jpeg.length - 1] = 217
  assert.equal(imageType(jpeg), null, 'unterminated marker fill bytes are not a JPEG')
  assert.throws(() => api.upload('u1', jpeg, 'image/jpeg', 'broken.jpg'), e => e.status === 400)
  const webp = Buffer.alloc(30); webp.write('RIFF'); webp.writeUInt32LE(22, 4); webp.write('WEBP', 8); webp.write('VP8L', 12); webp[20] = 47
  assert.equal(imageType(webp), null, 'a zero-length VP8L chunk cannot contain image dimensions')
  const extended = Buffer.alloc(42); extended.write('RIFF'); extended.writeUInt32LE(34, 4); extended.write('WEBP', 8); extended.write('VP8X', 12); extended.writeUInt32LE(10, 16); extended.write('EXIF', 30); extended.writeUInt32LE(4, 34); extended.write('VP8L', 38)
  assert.equal(imageType(extended), null, 'a codec name inside metadata is not a frame')
  const png = Buffer.from(image('png')); png[29] ^= 1
  assert.equal(imageType(png), null, 'PNG header CRC corruption must not be accepted')
  for (const ext of ['png', 'jpg', 'webp']) assert.ok(imageType(image(ext)), ext)
})

test('temporary screenshots expire consistently at exactly 24 hours and retries create usable uploads', t => {
  const { api, db } = fixture(t)
  const now = Date.parse('2026-11-18T04:00:00Z')
  t.mock.timers.enable({ apis: ['Date'], now })
  const a = api.upload('u1', image('png'), 'image/png', 'temporary.png', 'expiry-upload-001')
  db.prepare('UPDATE feedback_attachments SET created_at=? WHERE id=?').run(now - 86400000, a.id)
  assert.throws(() => api.readAttachment('u1', a.id), e => e.status === 404)
  assert.throws(() => api.submit('u1', input({ attachment_ids: [a.id] })), e => e.status === 422)
  const fresh = api.upload('u1', image('png'), 'image/png', 'temporary.png', 'expiry-upload-001')
  assert.notEqual(fresh.id, a.id)
  assert.equal(db.prepare('SELECT count(*) n FROM feedback_attachments WHERE id=?').get(a.id).n, 0)
  assert.equal(api.submit('u1', input({ attachment_ids: [fresh.id] })).attachments[0].id, fresh.id)
  t.mock.timers.tick(86400001)
  api.cleanup()
  assert.equal(api.readAttachment('u1', fresh.id).id, fresh.id, 'submitted images do not expire with drafts')
})

test('feedback pagination and filters reject structured values instead of coercing them or throwing 500', t => {
  const { api } = fixture(t)
  for (const query of [{ from: ['2026-11-18'] }, { to: ['2026-11-18'] }, { page: ['1'] }, { page: true }, { page_size: ['10'] }, { page: 0 }, { page_size: 0 }, { status: ['pending'] }, { q: { nested: 'text' } }, { page: '1e2' }, { page_size: '0x10' }]) {
    assert.throws(() => api.list('u1', query), e => e.status === 400, JSON.stringify(query))
  }
  assert.equal(api.list('u1', { from: '', to: '', q: '', page: '1', page_size: '10' }).page, 1)
  assert.throws(() => api.submit('u1', null), e => e.status === 400)
  assert.throws(() => api.update('admin', 'missing', null, {}), e => e.status === 400)
})

test('status-only changes preserve public reply timestamps, clearing replies and no-op saves are consistent', t => {
  const { api } = fixture(t)
  const now = Date.parse('2026-11-18T04:00:00Z'); t.mock.timers.enable({ apis: ['Date'], now })
  let record = api.submit('u1', input({ diagnostics_consent: true, diagnostics: { page_path: '/app', browser: 'QA', token: 'PRIVATE_TOKEN' } }))
  assert.deepEqual(record.diagnostics, { page_path: '/app', browser: 'QA' })
  record = api.update('admin', record.id, { status: 'processing', reply: '公开回复', internal_note: 'INTERNAL_ONLY', version: record.version }, {})
  const repliedAt = record.replied_at; const originalVersion = record.version
  record = api.update('admin', record.id, { status: 'processing', reply: '公开回复', internal_note: 'INTERNAL_ONLY', version: record.version }, {})
  assert.equal(record.version, originalVersion); assert.equal(record.history.length, 1)
  t.mock.timers.tick(1000)
  record = api.update('admin', record.id, { status: 'resolved', reply: '公开回复', internal_note: 'INTERNAL_ONLY', version: record.version }, {})
  assert.equal(record.replied_at, repliedAt)
  record = api.update('admin', record.id, { status: 'resolved', reply: '', internal_note: '', version: record.version }, {})
  assert.equal(record.replied_at, null); assert.equal(record.history.length, 3)
  const user = api.detail('u1', record.id)
  assert.equal('history' in user, false); assert.equal(JSON.stringify(user).includes('INTERNAL_ONLY'), false)
  assert.equal(JSON.stringify(api.exportUser('u1')).includes('PRIVATE_TOKEN'), false)
})


test('image validation preserves transparent and animated WebP support and bounds malformed header reads', () => {
  // 两张4×4合成图片：透明静态图和红蓝两帧动画，避免依赖系统图片工具。
  const alpha = 'UklGRl4AAABXRUJQVlA4WAoAAAAQAAAAAwAAAwAAQUxQSAoAAAABB1CyiAhERP8DVlA4IC4AAADQAQCdASoEAAQAAUAmJaACdLoB+AADsAD+6SIf+3Z/XZ/XZ/17f/kFywuuIwAA'
  const animation = 'UklGRuYAAABXRUJQVlA4WAoAAAASAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GWgAAAAAAAAAAAAMAAAMAAGQAAAJBTFBICgAAAAEHULKICERE/wNWUDggMAAAADABAJ0BKgQABAABQCYloAADcAD+6SIf//bs//9uz//27P+vb//8gx/oa/wV3YAAAEFOTUZYAAAAAAAAAAAAAwAAAwAAZAAAAkFMUEgKAAAAAQdQsogIRET/A1ZQOCAuAAAAMAEAnQEqBAAEAAFAJiWgAANwAP76eV///v2l//ftL/+/aX+vb/9CvWX30xcAAA=='
  assert.equal(imageType(Buffer.from(alpha, 'base64')), 'image/webp')
  assert.equal(imageType(Buffer.from(animation, 'base64')), 'image/webp')
  for (const ext of ['png', 'jpg', 'webp']) {
    const original = image(ext)
    for (let length = 0; length < original.length; length++) assert.doesNotThrow(() => imageType(original.subarray(0, length)), `${ext} truncated at ${length}`)
  }
  for (let length = 24; length < 128; length++) {
    const malformed = Buffer.alloc(length, 255); malformed[1] = 216; malformed[length - 1] = 217
    assert.equal(imageType(malformed), null)
  }
})
