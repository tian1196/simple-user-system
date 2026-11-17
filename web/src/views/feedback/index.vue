<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import { getFeedbackList } from '@/api/feedback'
import { feedbackDate, feedbackStatuses, feedbackTypes, type FeedbackList } from '../../../shared/feedback'
const router = useRouter()
const loading = ref(false); const error = ref(''); const data = ref<FeedbackList | null>(null)
const filters = reactive({ q: '', type: 'all', status: 'all', from: '', to: '' })
const page = ref(1); const pageSize = ref(10)
const counts = computed(() => data.value?.counts || { all: 0, pending: 0, processing: 0, resolved: 0 })
let run = 0
async function load() {
  const revision = ++run; loading.value = true; error.value = ''
  try {
    const result = await getFeedbackList({ ...filters, page: page.value, page_size: pageSize.value })
    if (revision !== run) return
    data.value = result
    window.dispatchEvent(new Event('feedback-updated'))
  } catch (cause) { if (revision === run) error.value = cause instanceof Error ? cause.message : '加载失败' }
  finally { if (revision === run) loading.value = false }
}
function search() { page.value = 1; void load() }
function reset() { Object.assign(filters, { q: '', type: 'all', status: 'all', from: '', to: '' }); search() }
function changePage(value: number) { page.value = value; void load() }
function changeSize(value: number) { pageSize.value = value; search() }
onMounted(load)
onBeforeUnmount(() => { run++ })
</script>
<template>
  <div class="page admin-feedback-page"><PageHeader title="用户反馈" description="集中查看内测意见，跟进问题与建议。"><el-button :loading="loading" @click="load">刷新列表</el-button></PageHeader>
    <div class="feedback-statistics panel"><div v-for="(label, key) in {all:'全部反馈',...feedbackStatuses}" :key="key"><span>{{ label }}</span><strong :class="key">{{ data ? counts[key] : '—' }}</strong></div></div>
    <section class="panel feedback-table-panel"><form class="toolbar feedback-toolbar" @submit.prevent="search"><el-input v-model="filters.q" placeholder="搜索编号 / 标题 / 用户名" aria-label="搜索反馈" maxlength="80" clearable /><el-select v-model="filters.type" aria-label="反馈类型"><el-option value="all" label="全部类型" /><el-option v-for="(label, key) in feedbackTypes" :key="key" :value="key" :label="label" /></el-select><el-select v-model="filters.status" aria-label="处理状态"><el-option value="all" label="全部状态" /><el-option v-for="(label, key) in feedbackStatuses" :key="key" :value="key" :label="label" /></el-select><label>开始日期 <input v-model="filters.from" type="date" /></label><label>结束日期 <input v-model="filters.to" type="date" /></label><el-button type="primary" native-type="submit">查询</el-button><el-button @click="reset">重置</el-button></form>
      <el-alert v-if="error" type="error" :closable="false" :title="error" description="已保留筛选和已有列表，请重新加载。" show-icon />
      <div class="feedback-list-heading"><h2>反馈列表 · 共 {{ data?.total ?? '—' }} 条</h2><span>按提交时间倒序 · 统计为全部反馈</span></div>
      <el-table v-loading="loading" :data="data?.items || []" empty-text="没有符合条件的反馈"><el-table-column prop="number" label="反馈编号" min-width="175" /><el-table-column prop="title" label="反馈标题" min-width="260" show-overflow-tooltip /><el-table-column label="类型" width="110"><template #default="{row}">{{ feedbackTypes[row.type as keyof typeof feedbackTypes] }}</template></el-table-column><el-table-column prop="username" label="提交用户" min-width="120" /><el-table-column label="提交时间" min-width="170"><template #default="{row}">{{ feedbackDate(row.created_at) }}</template></el-table-column><el-table-column label="状态" width="110"><template #default="{row}"><el-tag :type="row.status === 'pending' ? 'warning' : row.status === 'processing' ? 'primary' : 'success'">{{ feedbackStatuses[row.status as keyof typeof feedbackStatuses] }}</el-tag></template></el-table-column><el-table-column label="操作" fixed="right" width="80"><template #default="{row}"><el-button link type="primary" @click="router.push({name:'FeedbackDetail',params:{id:row.id}})">查看</el-button></template></el-table-column></el-table>
      <div class="pagination-bar"><el-pagination :current-page="page" :page-size="pageSize" :page-sizes="[10,20,50]" :total="data?.total || 0" layout="total, sizes, prev, pager, next" @current-change="changePage" @size-change="changeSize" /></div>
    </section><p class="feedback-admin-footnote">仅管理员和运营角色可查看与处理。公开回复仅向提交者展示，内部备注不向用户返回。</p>
  </div>
</template>
<style scoped lang="scss">
.feedback-statistics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:24px;margin-bottom:24px;gap:20px;div{display:flex;flex-direction:column;gap:10px}span{font-size:13px;color:var(--app-muted)}strong{font-size:28px}.pending{color:#b76c08}.processing{color:var(--app-primary)}.resolved{color:#16845b}}
.feedback-table-panel{padding:20px;overflow:hidden}.feedback-toolbar{align-items:end;margin-bottom:20px;.el-input{width:240px}.el-select{width:135px}label{display:flex;flex-direction:column;font-size:12px;gap:5px;color:var(--app-text-secondary)}input{padding:6px;border:1px solid var(--app-border);border-radius:6px}}
.feedback-list-heading{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:20px 0;h2{font-size:15px}span{font-size:12px;color:var(--app-muted)}}.feedback-admin-footnote{font-size:12px;color:var(--app-muted);margin-top:20px}@media(max-width:760px){.feedback-statistics{grid-template-columns:repeat(2,minmax(0,1fr))}.feedback-toolbar .el-input{width:100%}.feedback-table-panel{padding:14px}.pagination-bar{overflow-x:auto;justify-content:start}}
</style>
