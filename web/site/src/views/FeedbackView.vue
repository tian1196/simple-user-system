<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeading from '../components/PageHeading.vue'
import SiteButton from '../components/SiteButton.vue'
import { useFeedbackDraft } from '../stores/feedbackDraft'
import { useSessionStore } from '../stores/session'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { removeFeedbackImage, submitFeedback, uploadFeedbackImage } from '../api/feedback'
import { feedbackAttachmentUrl, feedbackKey, feedbackTypes, type FeedbackSubmission } from '../../../shared/feedback'
const draft = useFeedbackDraft()
const session = useSessionStore()
const route = useRoute()
const router = useRouter()
const source = typeof route.query.from === 'string' && /^\/app(?:\/|$)/.test(route.query.from) ? route.query.from.split(/[?#]/)[0].slice(0, 160) : '/app/feedback'
draft.prepare(session.user!.id, source)
const uploads = reactive<{ key: string; file: File; busy: boolean; error: string }[]>([])
const pending = ref(false)
const deleting = ref('')
const uploading = computed(() => uploads.some(file => file.busy))
const busy = computed(() => pending.value || uploading.value || Boolean(deleting.value))
const error = ref('')
const errorElement = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const dirty = computed(() => Boolean(draft.form.title || draft.form.content || draft.form.contact || draft.attachments.length || uploads.length))
const { leaveDialog, confirmLeave } = useUnsavedChanges(dirty, busy)
let active = true
let attempt = ''; let key = ''
async function showError(message: string) { error.value = message; await nextTick(); errorElement.value?.focus() }
async function upload(row: typeof uploads[number]) {
  row.busy = true; row.error = ''
  try {
    const item = await uploadFeedbackImage(row.file, row.key)
    if (!active) return
    draft.attachments.push(item)
    uploads.splice(uploads.indexOf(row), 1)
  } catch (cause) { if (active) row.error = cause instanceof Error ? cause.message : '上传失败，请重试' }
  finally { row.busy = false }
}
async function filesSelected(event: Event) {
  error.value = ''
  const files = Array.from((event.target as HTMLInputElement).files || [])
  ;(event.target as HTMLInputElement).value = ''
  if (draft.attachments.length + uploads.length + files.length > 3) return showError('最多上传3张截图，请先移除不需要的文件。')
  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) { await showError('请选择不超过5 MB的JPG、PNG或WebP截图。'); continue }
    const row = reactive({ key: feedbackKey(), file, busy: false, error: '' })
    uploads.push(row)
    await upload(row)
  }
}
async function remove(id: string) {
  if (busy.value) return
  deleting.value = id
  try { await removeFeedbackImage(id); if (active) draft.attachments = draft.attachments.filter(file => file.id !== id) }
  catch (cause) { if (active) await showError(cause instanceof Error ? cause.message : '移除失败') }
  finally { deleting.value = '' }
}
async function submit() {
  if (busy.value) return
  const title = draft.form.title.trim(); const content = draft.form.content.trim()
  if (!title || Array.from(title).length > 60) return showError('标题需为1–60个字符。')
  if (Array.from(content).length < 10 || Array.from(content).length > 2000) return showError('详细说明需为10–2,000个字符。')
  if (uploads.length) return showError('请先重试或移除上传失败的截图。')
  const data: FeedbackSubmission = { type: draft.form.type, title, content, contact: draft.form.contact.trim(), attachment_ids: draft.attachments.map(a => a.id), request_key: '', diagnostics_consent: draft.form.consent }
  if (draft.form.consent) data.diagnostics = { page_path: draft.form.source, browser: navigator.userAgent.slice(0, 240) }
  const current = JSON.stringify(data)
  if (current !== attempt) { attempt = current; key = feedbackKey() }
  data.request_key = key
  pending.value = true; error.value = ''
  try {
    const result = await submitFeedback(data)
    if (!active) return
    draft.reset(); uploads.splice(0); pending.value = false
    await router.replace({ name: 'site-feedback-mine', query: { feedback: result.id, submitted: result.number } })
  } catch (cause) { if (active) await showError(cause instanceof Error ? cause.message : '提交失败，已填写的内容保留，请重试') }
  finally { pending.value = false }
}
onMounted(() => { if (draft.form.title || draft.form.content) error.value = '已恢复本次会话内未提交的文字和已上传截图；未上传的本地文件请重新选择。' })
onBeforeUnmount(() => { active = false; leaveDialog.value?.close() })
</script>
<template>
  <div class="feedback-page site-container">
    <RouterLink class="muted feedback-breadcrumb" to="/app/account">账户与数据 / 意见反馈</RouterLink>
    <PageHeading title="让设备台账，变得更好用" description="使用中遇到的问题，或希望增加的小功能，都欢迎告诉我们。" />
    <nav class="feedback-tabs" aria-label="反馈功能"><SiteButton variant="primary" to="/app/feedback" aria-current="page">提交反馈</SiteButton><SiteButton to="/app/feedback/mine">我的反馈</SiteButton></nav>
    <div class="feedback-columns"><form class="feedback-panel feedback-form" @submit.prevent="submit">
      <p v-if="error" ref="errorElement" tabindex="-1" class="feedback-alert" role="alert">{{ error }}</p>
      <fieldset :disabled="busy"><legend>反馈类型 *</legend><div class="feedback-type-options"><label v-for="(label, value) in feedbackTypes" :key="value" :class="{ selected: draft.form.type === value }"><input v-model="draft.form.type" type="radio" name="feedback-type" :value="value" />{{ label }}</label></div>
      <label class="feedback-field">一句话描述 *<input v-model="draft.form.title" required maxlength="120" placeholder="例如：手机上导出日历后，无法打开文件" /><span class="feedback-count">{{ Array.from(draft.form.title).length }} / 60</span></label>
      <label class="feedback-field">详细说明 *<textarea v-model="draft.form.content" required rows="7" maxlength="4000" placeholder="可以告诉我们：&#10;1. 你当时正在做什么？&#10;2. 遇到了什么问题？&#10;3. 你希望得到什么结果？" /><span class="feedback-count">至少10个字符，最多2,000个字符 · {{ Array.from(draft.form.content).length }} / 2,000</span></label>
      </fieldset>
      <section aria-labelledby="feedback-attachment-title"><h2 id="feedback-attachment-title" class="feedback-label">补充截图（选填）</h2><input ref="input" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple :disabled="busy" @change="filesSelected" /><SiteButton :disabled="busy || draft.attachments.length + uploads.length >= 3" @click="input?.click()">＋ 添加截图</SiteButton><p class="muted feedback-small">最多3张，每张不超过5 MB。请遮挡密码、恢复码等敏感信息。</p>
      <ul class="feedback-files"><li v-for="file in draft.attachments" :key="file.id"><a :href="feedbackAttachmentUrl(file.id)" target="_blank" rel="noopener noreferrer"><img :src="feedbackAttachmentUrl(file.id)" :alt="file.filename" />{{ file.filename }}</a><SiteButton :disabled="busy" @click="remove(file.id)">移除</SiteButton></li><li v-for="row in uploads" :key="row.key"><span>{{ row.file.name }} · {{ row.busy ? '上传中…' : row.error }}</span><template v-if="!row.busy"><SiteButton :disabled="busy" @click="upload(row)">重试上传</SiteButton><SiteButton :disabled="busy" @click="uploads.splice(uploads.indexOf(row), 1)">移除</SiteButton></template></li></ul></section>
      <label class="feedback-field">联系方式（选填）<input v-model="draft.form.contact" :disabled="busy" maxlength="128" placeholder="邮箱或微信，仅用于跟进这条反馈" /></label>
      <label class="feedback-consent"><input v-model="draft.form.consent" type="checkbox" :disabled="busy" />附带当前页面和浏览器信息（选填，用于帮助定位问题）</label>
      <p class="muted feedback-small">将以 {{ session.user?.username }} 的身份提交，仅你和有权限的管理员可见。不会自动上传设备台账或登录凭证。</p>
      <SiteButton type="submit" variant="primary" :disabled="uploading || Boolean(deleting)" :loading="pending">提交反馈</SiteButton>
    </form><aside class="feedback-help"><div class="feedback-panel"><span class="feedback-tag">内测共创</span><h2>每一条反馈，都会认真看。</h2><p>提交后可在“我的反馈”查看处理进度和管理员回复。</p><p>我们可能无法立即回复，但会优先排查影响使用的问题。</p></div><h3>01 提交反馈</h3><p>描述问题或想法，截图可选。</p><h3>02 查看进度</h3><p>待处理 → 处理中 → 已处理。</p><h3>03 查看回复</h3><p>处理结果保留在反馈详情中，不发送站外通知。</p></aside></div>
    <dialog ref="leaveDialog" class="reminder-dialog" aria-labelledby="feedback-leave-title" @cancel.prevent="confirmLeave(false)"><h2 id="feedback-leave-title">反馈尚未提交</h2><p>继续编辑，或离开页面。本次会话内草稿会暂时保留；未上传的本地文件需要重新选择。</p><div class="feedback-actions"><SiteButton variant="primary" @click="confirmLeave(false)">继续编辑</SiteButton><SiteButton @click="confirmLeave(true)">离开页面</SiteButton></div></dialog>
  </div>
</template>
