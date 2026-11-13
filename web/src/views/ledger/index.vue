<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'

import { getAdminLedger, type LedgerCategoryStat, type LedgerDay, type LedgerEntry } from '@/api/ledger'
import PageHeader from '@/components/PageHeader.vue'

const KIND_LABELS = { expense: '支出', income: '收入' } as const

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthRange(offset = 0): [Date, Date] {
  const now = new Date()
  return [
    new Date(now.getFullYear(), now.getMonth() + offset, 1),
    new Date(now.getFullYear(), now.getMonth() + offset + 1, 0),
  ]
}

function recentRange(length: number): [Date, Date] {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - (length - 1))
  return [start, end]
}

const shortcuts = [
  { text: '本月', value: () => monthRange(0) },
  { text: '上月', value: () => monthRange(-1) },
  { text: '近7天', value: () => recentRange(7) },
  { text: '近30天', value: () => recentRange(30) },
]

const loading = ref(false)
const items = ref<LedgerEntry[]>([])
const categories = ref<LedgerCategoryStat[]>([])
const days = ref<LedgerDay[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const summary = ref({ expense: '0.00', income: '0.00', balance: '0.00', balance_cents: 0 })
const filters = reactive({ q: '', kind: '' as '' | 'expense' | 'income' })
const range = ref<[string, string] | null>(monthRange(0).map(iso) as [string, string])
const expenseStats = computed(() => categories.value.filter((item) => item.kind === 'expense'))
const incomeStats = computed(() => categories.value.filter((item) => item.kind === 'income'))

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await getAdminLedger({
      q: filters.q,
      kind: filters.kind,
      from: range.value?.[0],
      to: range.value?.[1],
      page: page.value,
      page_size: pageSize.value,
    })
    items.value = data.items
    categories.value = data.categories
    days.value = data.days
    total.value = data.total
    page.value = data.page
    summary.value = data.summary
  } catch {
    // 全局错误提示已处理
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void load()
}

function changePageSize(): void {
  page.value = 1
  void load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <PageHeader title="消费记账" description="按日期区间查看所有账号的收支，并给出分类统计。这里只读，不能替别人改账。">
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <section class="summary">
      <article>
        <span>支出</span>
        <strong class="is-expense">{{ summary.expense }}</strong>
      </article>
      <article>
        <span>收入</span>
        <strong class="is-income">{{ summary.income }}</strong>
      </article>
      <article>
        <span>结余</span>
        <strong :class="summary.balance_cents < 0 ? 'is-expense' : 'is-income'">{{ summary.balance }}</strong>
      </article>
    </section>

    <section class="panel">
      <div class="toolbar">
        <el-date-picker
          v-model="range"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :shortcuts="shortcuts"
          clearable
        />
        <el-select v-model="filters.kind" class="kind-select" placeholder="全部类型">
          <el-option label="全部类型" value="" />
          <el-option label="支出" value="expense" />
          <el-option label="收入" value="income" />
        </el-select>
        <el-input
          v-model="filters.q"
          placeholder="搜索账号或备注"
          clearable
          class="search-input"
          @keyup.enter="search"
          @clear="search"
        />
        <el-button type="primary" :icon="Search" @click="search">查询</el-button>
      </div>
      <div v-if="expenseStats.length || incomeStats.length" class="stats">
        <div>
          <h3>支出构成</h3>
          <div v-for="item in expenseStats" :key="`expense-${item.category}`" class="stat-row">
            <span>{{ item.category_label }}</span>
            <span class="track"><span class="fill is-expense-bar" :style="{ width: `${Math.max(item.share, 2)}%` }" /></span>
            <strong>{{ item.amount }} · {{ item.share }}%</strong>
          </div>
          <p v-if="!expenseStats.length" class="empty-line">没有支出</p>
        </div>
        <div>
          <h3>收入构成</h3>
          <div v-for="item in incomeStats" :key="`income-${item.category}`" class="stat-row">
            <span>{{ item.category_label }}</span>
            <span class="track"><span class="fill is-income-bar" :style="{ width: `${Math.max(item.share, 2)}%` }" /></span>
            <strong>{{ item.amount }} · {{ item.share }}%</strong>
          </div>
          <p v-if="!incomeStats.length" class="empty-line">没有收入</p>
        </div>
      </div>
      <p v-if="days.length" class="day-count">区间内有记账的日期 {{ days.length }} 天</p>
      <el-table v-loading="loading" :data="items" row-key="id">
        <el-table-column label="日期" prop="occurred_on" width="120" />
        <el-table-column label="账号" prop="username" min-width="140" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">{{ KIND_LABELS[row.kind as 'expense' | 'income'] }}</template>
        </el-table-column>
        <el-table-column label="分类" prop="category_label" width="100" />
        <el-table-column label="金额" width="120">
          <template #default="{ row }">
            <span :class="row.kind === 'expense' ? 'is-expense' : 'is-income'">
              {{ row.kind === 'expense' ? '-' : '+' }}{{ row.amount }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="220">
          <template #default="{ row }">{{ row.note || '—' }}</template>
        </el-table-column>
        <template #empty>
          <div class="empty-hint">
            <p>没有匹配的账</p>
            <span>换一个日期区间、类型或关键词后再查询。</span>
          </div>
        </template>
      </el-table>
      <div class="pagination-bar">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="load"
          @size-change="changePageSize"
        />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;

  article {
    padding: 16px 18px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 10px;
  }

  span {
    color: var(--app-text-secondary);
    font-size: 13px;
  }

  strong {
    display: block;
    margin-top: 6px;
    font-size: 24px;
  }
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 16px;
}

.kind-select {
  width: 140px;
}

.search-input {
  width: 220px;
}

.is-expense {
  color: #b42318;
  font-weight: 650;
}

.is-income {
  color: #027a48;
  font-weight: 650;
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  padding: 0 16px 8px;
}

.stats h3 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 650;
}

.stat-row {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  font-size: 13px;
}

.track {
  display: block;
  height: 8px;
  overflow: hidden;
  background: var(--app-border);
  border-radius: 99px;
}

.fill {
  display: block;
  height: 100%;
}

.is-expense-bar {
  background: #d26b5f;
}

.is-income-bar {
  background: #3d8b66;
}

.empty-line,
.day-count {
  margin: 8px 16px 12px;
  color: var(--app-text-secondary);
  font-size: 13px;
}

@media (max-width: 760px) {
  .summary,
  .stats,
  .stat-row {
    grid-template-columns: 1fr;
  }
}
</style>
