<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageHeading from '../components/PageHeading.vue'
import SiteButton from '../components/SiteButton.vue'
import PageState from '../components/PageState.vue'
import { getFeedback, listFeedback } from '../api/feedback'
import { feedbackAttachmentUrl, feedbackDate, feedbackStatuses, feedbackTypes, type FeedbackDetail, type FeedbackList } from '../../../shared/feedback'
const route = useRoute()
const data = ref<FeedbackList | null>(null)
const filter = ref('all'); const page = ref(1); const loading = ref(false); const error = ref('')
const selected = ref<FeedbackDetail | null>(null); const detailError = ref(''); const detailLoading = ref(false)
let listController: AbortController | undefined; let detailController: AbortController | undefined
const submitted = computed(() => typeof route.query.submitted === 'string' ? route.query.submitted.slice(0, 40) : '')
async function load() {
  listController?.abort(); const c = new AbortController(); listController = c
  loading.value = true; error.value = ''
  try { const value = await listFeedback({ status: filter.value, page: page.value }, c.signal); if (!c.signal.aborted) data.value = value }
  catch (cause) { if (!c.signal.aborted) error.value = cause instanceof Error ? cause.message : '加载失败' }
  finally { if (!c.signal.aborted) loading.value = false }
}
async function loadDetail() {
  detailController?.abort(); const id = route.query.feedback; selected.value = null; detailError.value = ''
  if (typeof id !== 'string') { detailLoading.value = false; return }
  const c = new AbortController(); detailController = c; detailLoading.value = true
  try { const value = await getFeedback(id, c.signal); if (!c.signal.aborted) selected.value = value }
  catch (cause) { if (!c.signal.aborted) detailError.value = cause instanceof Error ? cause.message : '详情加载失败' }
  finally { if (!c.signal.aborted) detailLoading.value = false }
}
function refresh() { void load(); void loadDetail() }
watch(filter, () => { page.value = 1; void load() })
watch(page, load)
watch(() => route.query.feedback, loadDetail)
onMounted(() => { void load(); void loadDetail() })
onBeforeUnmount(() => { listController?.abort(); detailController?.abort() })
</script>
<template>
  <div class="feedback-page feedback-mine site-container"><PageHeading title="你的声音，有迹可循" description="这里只展示你提交的反馈，管理员的回复也会保留在这里。" />
    <nav class="feedback-tabs" aria-label="反馈功能"><SiteButton to="/app/feedback">提交反馈</SiteButton><SiteButton variant="primary" to="/app/feedback/mine" aria-current="page">我的反馈 {{ data?.counts.all ?? '' }}</SiteButton></nav>
    <p v-if="submitted && selected" class="feedback-success" role="status">反馈已提交，编号 {{ selected.number }}。谢谢你帮助我们改进！</p>
    <div class="feedback-actions"><label>处理状态 <select v-model="filter"><option value="all">全部</option><option v-for="(label, key) in feedbackStatuses" :key="key" :value="key">{{ label }} {{ data?.counts[key] ?? '' }}</option></select></label><SiteButton :loading="loading" @click="refresh">刷新列表</SiteButton></div>
    <PageState v-if="loading && !data" kind="loading" title="正在加载反馈" /><PageState v-if="error" kind="error" :title="error" description="已有列表可能尚未更新。" retry @retry="load" />
    <PageState v-if="data && !data.items.length && !error" kind="empty" title="还没有符合条件的反馈" description="遇到问题或想到新功能时，随时来这里告诉我们。"><SiteButton to="/app/feedback" variant="primary">提交反馈</SiteButton></PageState>
    <ul v-if="data?.items.length" class="feedback-records"><li v-for="item in data.items" :key="item.id" class="feedback-panel"><div class="feedback-actions"><span class="feedback-tag">{{ feedbackTypes[item.type] }}</span><span class="feedback-tag" :class="`is-${item.status}`">{{ feedbackStatuses[item.status] }}</span></div><h2>{{ item.title }}</h2><div class="feedback-record-meta"><p class="muted feedback-small">{{ item.number }} · {{ feedbackDate(item.created_at) }}</p><SiteButton :to="{ name: 'site-feedback-mine', query: { feedback: item.id } }">查看详情</SiteButton></div></li></ul>
    <div v-if="data && data.total > 10" class="feedback-actions feedback-pagination"><SiteButton :disabled="page <= 1 || loading" @click="page--">上一页</SiteButton><span>第 {{ page }} 页 · 共 {{ data.total }} 条</span><SiteButton :disabled="page * 10 >= data.total || loading" @click="page++">下一页</SiteButton></div>
    <PageState v-if="detailLoading" kind="loading" title="正在加载详情" /><PageState v-if="detailError" kind="error" :title="detailError" retry @retry="loadDetail" />
    <section v-if="selected" class="feedback-panel feedback-detail" aria-labelledby="my-feedback-detail-title"><div class="feedback-record-meta"><span class="feedback-tag" :class="`is-${selected.status}`">{{ feedbackStatuses[selected.status] }}</span><SiteButton :to="{ name: 'site-feedback-mine' }">收起详情</SiteButton></div><h2 id="my-feedback-detail-title">{{ selected.title }}</h2><p class="muted feedback-small">{{ selected.number }} · {{ feedbackDate(selected.created_at) }}</p><p class="feedback-prose">{{ selected.content }}</p><ul class="feedback-files"><li v-for="file in selected.attachments" :key="file.id"><a :href="feedbackAttachmentUrl(file.id)" target="_blank" rel="noopener noreferrer"><img :src="feedbackAttachmentUrl(file.id)" :alt="file.filename" />{{ file.filename }}</a></li></ul><p v-if="selected.contact" class="muted feedback-small">你提供的联系方式：{{ selected.contact }}</p><div v-if="selected.reply" class="feedback-reply"><h3>管理员回复</h3><p class="feedback-prose">{{ selected.reply }}</p><p class="muted feedback-small">{{ feedbackDate(selected.replied_at) }}</p></div><p v-else class="muted">暂未回复，可稍后回来查看处理进度。</p></section>
    <p class="muted feedback-small">反馈不是公开留言板，其他用户无法看到你的反馈及联系方式。</p>
  </div>
</template>
