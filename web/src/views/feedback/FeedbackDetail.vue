<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { getFeedbackDetail, updateFeedback } from '@/api/feedback'
import { feedbackAttachmentUrl, feedbackDate, feedbackStatuses, feedbackTypes, type AdminFeedback, type FeedbackHandling } from '../../../shared/feedback'
const route = useRoute(); const router = useRouter()
const item = ref<AdminFeedback | null>(null); const latest = ref<AdminFeedback | null>(null)
const loading = ref(false); const busy = ref(false); const error = ref(''); const conflict = ref(false)
const form = reactive<FeedbackHandling>({ status: 'pending', reply: '', internal_note: '' })
const original = ref(''); let revision = 0
const snapshot = () => JSON.stringify(form)
const dirty = computed(() => Boolean(item.value) && snapshot() !== original.value)
function apply(value: AdminFeedback) { item.value = value; Object.assign(form, { status: value.status, reply: value.reply, internal_note: value.internal_note }); original.value = snapshot(); conflict.value = false; latest.value = null }
async function askDiscard(message = '有尚未保存的修改，是否放弃修改？') {
  try { await ElMessageBox.confirm(message, '确认操作', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning' }); return true } catch { return false }
}
async function canLeave(to: {name?: unknown}) { if (to.name === 'Login') return true; if (busy.value) return false; return !dirty.value || await askDiscard() }
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate(canLeave)
async function load() {
  if (busy.value || (dirty.value && !await askDiscard('重新加载将放弃当前草稿，是否继续？'))) return
  const run = ++revision; loading.value = true; error.value = ''
  try { const value = await getFeedbackDetail(String(route.params.id)); if (run === revision) apply(value) }
  catch (cause) { if (run === revision) error.value = cause instanceof Error ? cause.message : '详情加载失败' }
  finally { if (run === revision) loading.value = false }
}
async function seeLatest() {
  if (loading.value) return
  const run = ++revision; loading.value = true
  try { const value = await getFeedbackDetail(String(route.params.id)); if (run === revision) latest.value = value }
  catch (cause) { if (run === revision) error.value = cause instanceof Error ? cause.message : '加载失败' }
  finally { if (run === revision) loading.value = false }
}
async function useLatest() { if (latest.value && await askDiscard('将以最新处理内容替换当前草稿，是否继续？')) { apply(latest.value); error.value = '' } }
async function cancelChanges() { if (item.value && (!dirty.value || await askDiscard())) { apply(item.value); error.value = '' } }
async function save() {
  if (!item.value || busy.value || !dirty.value || conflict.value) return
  if ([form.reply, form.internal_note].some(value => Array.from(value.trim()).length > 2000)) { error.value = '回复和内部备注最多各2,000个字符'; return }
  if ((item.value.reply && !form.reply.trim()) || (item.value.internal_note && !form.internal_note.trim())) {
    try { await ElMessageBox.confirm('本次将清空已有回复或内部备注，变更会留在处理历史中。是否继续？', '确认清空内容', { confirmButtonText: '确认清空并保存', cancelButtonText: '继续编辑', type: 'warning' }) } catch { return }
  }
  busy.value = true; error.value = ''
  const run = ++revision
  try {
    const value = await updateFeedback(item.value.id, { ...form, version: item.value.version })
    if (run !== revision) return
    apply(value); ElMessage.success('处理结果已保存'); window.dispatchEvent(new Event('feedback-updated'))
  } catch (cause) {
    if (run !== revision) return
    const detail = cause as {code?: string; message?: string}
    conflict.value = detail.code === 'VERSION_CONFLICT'
    error.value = detail.message || '保存失败，草稿已保留'
  } finally { if (run === revision) busy.value = false }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload) })
watch(() => route.params.id, () => { item.value = null; original.value = ''; void load() })
onBeforeUnmount(() => { revision++; window.removeEventListener('beforeunload', beforeUnload) })
</script>
<template>
  <div class="page feedback-admin-detail"><el-button :disabled="busy" @click="router.push('/feedback')">← 返回反馈列表</el-button><PageHeader :title="item?.title || '反馈详情'" :description="item?.number || '查看用户反馈及处理进度'"><el-tag v-if="item" :type="item.status === 'pending' ? 'warning' : item.status === 'processing' ? 'primary' : 'success'">{{ feedbackStatuses[item.status] }}</el-tag></PageHeader>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><template #default><el-button v-if="conflict" link type="primary" :loading="loading" @click="seeLatest">查看最新内容</el-button><el-button v-else link type="primary" :loading="loading" :disabled="busy" @click="load">重新加载详情</el-button></template></el-alert>
    <el-skeleton v-if="loading && !item" :rows="8" animated />
    <div v-if="item" class="feedback-detail-columns"><div class="feedback-original-column"><section class="panel feedback-detail-panel"><h2>反馈内容</h2><p class="feedback-meta"><el-tag effect="plain">{{ feedbackTypes[item.type] }}</el-tag> {{ item.username }} · {{ feedbackDate(item.created_at) }}</p><p class="feedback-text">{{ item.content }}</p><h3 v-if="item.attachments.length">附件截图（{{ item.attachments.length }}张）</h3><ul class="admin-feedback-images"><li v-for="file in item.attachments" :key="file.id"><el-image :src="feedbackAttachmentUrl(file.id,true)" :preview-src-list="[feedbackAttachmentUrl(file.id,true)]" fit="contain" preview-teleported><template #error>截图加载失败</template></el-image><a :href="feedbackAttachmentUrl(file.id,true)" target="_blank" rel="noopener noreferrer">{{ file.filename }} ↗</a><span>{{ Math.ceil(file.size / 1024) }} KB</span></li></ul><p class="feedback-text feedback-muted">联系方式：{{ item.contact || '未提供' }}<br />来源页面：{{ item.diagnostics?.page_path || '未提供' }}<br />浏览器与系统：{{ item.diagnostics?.browser || '未授权附带' }}</p></section>
    <section class="panel feedback-detail-panel"><h2>处理历史</h2><p class="feedback-muted">{{ feedbackDate(item.created_at) }} · 用户提交反馈 · 待处理</p><el-empty v-if="!item.history.length" description="暂无管理员处理记录" :image-size="50" /><el-collapse><el-collapse-item v-for="history in item.history" :key="history.id" :title="`${feedbackDate(history.created_at)} · ${history.actor} · ${feedbackStatuses[history.after.status]}`" :name="history.id"><p>状态：{{ feedbackStatuses[history.before.status] }} → {{ feedbackStatuses[history.after.status] }}</p><h3>用户可见回复变更</h3><p class="feedback-text">修改前：{{ history.before.reply || '空' }}<br />修改后：{{ history.after.reply || '空' }}</p><h3>内部备注变更</h3><p class="feedback-text">修改前：{{ history.before.internal_note || '空' }}<br />修改后：{{ history.after.internal_note || '空' }}</p></el-collapse-item></el-collapse></section></div>
    <section class="panel feedback-detail-panel feedback-processing"><h2>处理反馈</h2><p class="feedback-muted">当前状态：{{ feedbackStatuses[item.status] }}</p><el-tag v-if="dirty" type="warning">有未保存的修改</el-tag><el-form label-position="top" @submit.prevent="save"><el-form-item label="处理状态"><el-radio-group v-model="form.status" :disabled="busy || loading"><el-radio v-for="(label,key) in feedbackStatuses" :key="key" :value="key">{{ label }}</el-radio></el-radio-group></el-form-item><el-form-item label="回复用户（用户可见）"><el-input v-model="form.reply" type="textarea" :rows="6" maxlength="2000" show-word-limit :disabled="busy || loading" /></el-form-item><p class="feedback-muted">保存后，用户可在“我的反馈”查看，不发送邮件或站外消息。</p><el-form-item label="内部备注（仅管理员可见）"><el-input v-model="form.internal_note" type="textarea" :rows="4" maxlength="2000" show-word-limit :disabled="busy || loading" /></el-form-item><p class="feedback-muted">不会展示给用户。请勿填写密码、恢复码等敏感内容。</p><el-button type="primary" native-type="submit" :loading="busy" :disabled="!dirty || conflict || loading">保存处理结果</el-button><el-button :disabled="busy || loading || !dirty" @click="cancelChanges">取消修改</el-button></el-form>
    <section v-if="latest" class="feedback-latest"><h3>最新处理内容</h3><p>状态：{{ feedbackStatuses[latest.status] }}</p><p class="feedback-text">用户回复：{{ latest.reply || '空' }}<br />内部备注：{{ latest.internal_note || '空' }}</p><el-button :disabled="busy" @click="useLatest">载入最新并重新编辑</el-button><p class="feedback-muted">你的草稿仍保留在上方，载入前请自行确认差异。</p></section></section></div>
  </div>
</template>
<style scoped lang="scss">
.feedback-admin-detail>.page-header{margin-top:24px}.feedback-detail-columns{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(320px,1fr);gap:24px;margin-top:24px;align-items:start}.feedback-original-column{display:flex;flex-direction:column;gap:24px}.feedback-detail-panel{padding:26px;min-width:0;h2{font-size:18px;margin-bottom:20px}h3{font-size:14px;margin:18px 0 10px}}.feedback-meta{display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:13px;color:var(--app-muted)}.feedback-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;margin:18px 0}.feedback-muted{color:var(--app-muted);font-size:12px;line-height:1.8;margin-bottom:18px;overflow-wrap:anywhere}.admin-feedback-images{display:flex;flex-direction:column;gap:18px;list-style:none;padding:0;li{display:flex;flex-direction:column;gap:8px;font-size:12px;overflow-wrap:anywhere}.el-image{width:100%;height:160px;background:#f7f9fc}a{color:var(--app-primary)}}.feedback-processing .el-form{margin-top:20px}.feedback-processing .el-radio-group{display:flex;flex-wrap:wrap}.feedback-latest{margin-top:26px;padding-top:20px;border-top:1px solid var(--app-border)}@media(max-width:1000px){.feedback-detail-columns{grid-template-columns:minmax(0,1fr)}}
</style>
