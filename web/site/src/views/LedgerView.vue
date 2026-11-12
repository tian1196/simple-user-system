<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import PageHeading from '../components/PageHeading.vue'
import SiteButton from '../components/SiteButton.vue'
import PageState from '../components/PageState.vue'
import { SiteApiError } from '../api/request'
import {
  createLedgerEntry,
  deleteLedgerEntry,
  listLedger,
  updateLedgerEntry,
  type LedgerEntry,
  type LedgerMonth,
} from '../api/ledger'

type Kind = 'expense' | 'income'

function thisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const month = ref(thisMonth())
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const formError = ref('')
const data = ref<LedgerMonth | null>(null)
const editingId = ref<string | null>(null)
const form = reactive({
  kind: 'expense' as Kind,
  category: 'food',
  amount: '',
  occurred_on: today(),
  note: '',
  version: 1,
})

const categories = computed(() => data.value?.catalog[form.kind] || [])
const groups = computed(() => {
  const grouped = new Map<string, LedgerEntry[]>()
  for (const item of data.value?.items || []) {
    const list = grouped.get(item.occurred_on) || []
    list.push(item)
    grouped.set(item.occurred_on, list)
  }
  return [...grouped.entries()]
})

watch(
  () => form.kind,
  () => {
    if (!categories.value.some((item) => item.key === form.category)) {
      form.category = categories.value[0]?.key || 'other'
    }
  },
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    data.value = await listLedger(month.value)
  } catch (cause) {
    error.value = cause instanceof SiteApiError ? cause.message : '暂时无法加载记账'
  } finally {
    loading.value = false
  }
}

function resetForm(): void {
  editingId.value = null
  form.kind = 'expense'
  form.category = 'food'
  form.amount = ''
  form.occurred_on = today()
  form.note = ''
  form.version = 1
  formError.value = ''
}

function edit(item: LedgerEntry): void {
  editingId.value = item.id
  form.kind = item.kind
  form.category = item.category
  form.amount = item.amount
  form.occurred_on = item.occurred_on
  form.note = item.note
  form.version = item.version
  formError.value = ''
}

async function submit(): Promise<void> {
  formError.value = ''
  saving.value = true
  try {
    const payload = {
      kind: form.kind,
      category: form.category,
      amount: form.amount.trim(),
      occurred_on: form.occurred_on,
      note: form.note.trim(),
    }
    if (editingId.value) {
      await updateLedgerEntry(editingId.value, { ...payload, version: form.version })
    } else {
      await createLedgerEntry(payload)
    }
    const savedMonth = form.occurred_on.slice(0, 7)
    resetForm()
    if (savedMonth !== month.value) month.value = savedMonth
    await load()
  } catch (cause) {
    formError.value = cause instanceof SiteApiError ? cause.message : '没有保存成功，请重试'
  } finally {
    saving.value = false
  }
}

async function remove(item: LedgerEntry): Promise<void> {
  if (!window.confirm(`删除这笔${item.kind === 'expense' ? '支出' : '收入'} ${item.amount} 元？`)) return
  formError.value = ''
  try {
    await deleteLedgerEntry(item.id, item.version)
    if (editingId.value === item.id) resetForm()
    await load()
  } catch (cause) {
    formError.value = cause instanceof SiteApiError ? cause.message : '没有删除成功，请重试'
  }
}

onMounted(load)
</script>

<template>
  <div class="ledger-page">
    <PageHeading title="记账" description="记下午餐、交通这些日常收支。只对自己可见，管理员可以在后台查看汇总。" />
    <PageState v-if="loading && !data" kind="loading" title="正在加载这个月的账…" />
    <PageState v-else-if="error && !data" kind="error" title="暂时无法加载记账" :description="error" retry @retry="load" />
    <template v-else-if="data">
      <div class="ledger-toolbar">
        <label>
          月份
          <input v-model="month" type="month" @change="load" />
        </label>
      </div>
      <dl class="money-summary">
        <div>
          <dt>支出</dt>
          <dd class="is-expense">{{ data.summary.expense }}</dd>
        </div>
        <div>
          <dt>收入</dt>
          <dd class="is-income">{{ data.summary.income }}</dd>
        </div>
        <div>
          <dt>结余</dt>
          <dd :class="data.summary.balance_cents < 0 ? 'is-expense' : 'is-income'">{{ data.summary.balance }}</dd>
        </div>
      </dl>
      <ul v-if="data.categories.length" class="category-row">
        <li v-for="item in data.categories" :key="`${item.kind}-${item.category}`">
          {{ item.category_label }} {{ item.amount }}
        </li>
      </ul>

      <form class="entry-form" @submit.prevent="submit">
        <div class="kind-switch" role="group" aria-label="收支类型">
          <button type="button" :class="{ 'is-selected': form.kind === 'expense' }" @click="form.kind = 'expense'">支出</button>
          <button type="button" :class="{ 'is-selected': form.kind === 'income' }" @click="form.kind = 'income'">收入</button>
        </div>
        <label>
          金额
          <input v-model="form.amount" inputmode="decimal" placeholder="例如 28.50" required />
        </label>
        <label>
          分类
          <select v-model="form.category">
            <option v-for="item in categories" :key="item.key" :value="item.key">{{ item.label }}</option>
          </select>
        </label>
        <label>
          日期
          <input v-model="form.occurred_on" type="date" required />
        </label>
        <label class="note-field">
          备注
          <input v-model="form.note" maxlength="200" placeholder="例如午餐" />
        </label>
        <div class="form-actions">
          <SiteButton type="submit" variant="primary" :loading="saving">{{ editingId ? '保存修改' : '记一笔' }}</SiteButton>
          <SiteButton v-if="editingId" type="button" @click="resetForm">取消</SiteButton>
        </div>
        <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      </form>

      <p v-if="!groups.length" class="empty-month">这个月还没有账。先记一笔午餐吧。</p>
      <section v-for="[day, items] in groups" :key="day" class="day-group">
        <h2>{{ day }}</h2>
        <ul>
          <li v-for="item in items" :key="item.id">
            <div>
              <strong>{{ item.category_label }}</strong>
              <p v-if="item.note">{{ item.note }}</p>
            </div>
            <span :class="item.kind === 'expense' ? 'is-expense' : 'is-income'">
              {{ item.kind === 'expense' ? '-' : '+' }}{{ item.amount }}
            </span>
            <div class="row-actions">
              <button type="button" @click="edit(item)">修改</button>
              <button type="button" @click="remove(item)">删除</button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ledger-page {
  width: min(880px, calc(100% - var(--site-gutter) * 2));
  padding-block: 48px 64px;
  margin-inline: auto;
}
.ledger-toolbar input,
.entry-form input,
.entry-form select {
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid var(--site-border);
  border-radius: 8px;
  background: var(--site-surface);
  font: inherit;
}
.money-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 20px 0;
}
.money-summary div {
  padding: 16px 18px;
  background: var(--site-surface);
  border: 1px solid var(--site-border);
  border-radius: 10px;
}
.money-summary dt {
  color: var(--site-muted);
  font-size: 13px;
}
.money-summary dd {
  margin: 6px 0 0;
  font-size: 24px;
  font-weight: 650;
}
.category-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
}
.category-row li {
  padding: 6px 10px;
  background: #f4f7f1;
  border-radius: 999px;
  font-size: 13px;
}
.entry-form {
  display: grid;
  grid-template-columns: 140px 1fr 1fr;
  gap: 12px;
  margin-bottom: 28px;
  padding: 20px;
  background: var(--site-surface);
  border: 1px solid var(--site-border);
  border-radius: 10px;
}
.entry-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--site-muted);
}
.kind-switch,
.form-actions,
.note-field {
  grid-column: 1 / -1;
}
.kind-switch {
  display: flex;
  gap: 8px;
}
.kind-switch button,
.row-actions button {
  min-height: 36px;
  padding: 6px 14px;
  border: 1px solid var(--site-border);
  border-radius: 8px;
  background: transparent;
  font: inherit;
}
.kind-switch button.is-selected {
  color: white;
  background: var(--site-accent);
  border-color: var(--site-accent);
}
.form-actions {
  display: flex;
  gap: 8px;
}
.form-error {
  grid-column: 1 / -1;
  margin: 0;
  color: #8a2b22;
}
.day-group h2 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--site-muted);
}
.day-group ul {
  margin: 0 0 18px;
  padding: 0;
  list-style: none;
  background: var(--site-surface);
  border: 1px solid var(--site-border);
  border-radius: 10px;
}
.day-group li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border-top: 1px solid var(--site-border);
}
.day-group li:first-child {
  border-top: 0;
}
.day-group p {
  margin: 4px 0 0;
  color: var(--site-muted);
  font-size: 13px;
}
.empty-month {
  color: var(--site-muted);
}
.is-expense {
  color: #8a2b22;
  font-weight: 650;
}
.is-income {
  color: #1f6b45;
  font-weight: 650;
}
@media (max-width: 760px) {
  .ledger-page {
    padding-block: 32px 48px;
  }
  .money-summary,
  .entry-form {
    grid-template-columns: 1fr;
  }
  .day-group li {
    grid-template-columns: 1fr auto;
  }
  .row-actions {
    grid-column: 1 / -1;
  }
}
</style>
