<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'

import { getAdminLedger, type LedgerEntry } from '@/api/ledger'
import PageHeader from '@/components/PageHeader.vue'

const KIND_LABELS = { expense: '支出', income: '收入' } as const

function thisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const loading = ref(false)
const items = ref<LedgerEntry[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const summary = ref({ expense: '0.00', income: '0.00', balance: '0.00', balance_cents: 0 })
const filters = reactive({ q: '', kind: '' as '' | 'expense' | 'income', month: thisMonth() })

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await getAdminLedger({
      q: filters.q,
      kind: filters.kind,
      month: filters.month,
      page: page.value,
      page_size: pageSize.value,
    })
    items.value = data.items
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
    <PageHeader title="消费记账" description="查看所有账号记下的支出和收入。这里只读，不能替别人改账。">
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
          v-model="filters.month"
          type="month"
          value-format="YYYY-MM"
          placeholder="全部月份"
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
            <span>换一个月份、类型或关键词后再查询。</span>
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

@media (max-width: 760px) {
  .summary {
    grid-template-columns: 1fr;
  }
}
</style>
