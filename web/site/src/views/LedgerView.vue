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
  type LedgerBook,
  type LedgerEntry,
} from '../api/ledger'

type Kind = 'expense' | 'income'
type Preset = 'month' | 'last' | 'week' | 'thirty' | 'custom'
type Panel = 'list' | 'stats'

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'month', label: '本月' },
  { id: 'last', label: '上月' },
  { id: 'week', label: '近7天' },
  { id: 'thirty', label: '近30天' },
  { id: 'custom', label: '自定义' },
]
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function today(): string {
  return iso(new Date())
}

function monthEdges(offset: number): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: iso(start), to: iso(end) }
}

function recentDays(length: number): { from: string; to: string } {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - (length - 1))
  return { from: iso(start), to: iso(end) }
}

function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()]
  return `${month}月${day}日 周${weekday}`
}

function yuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

const preset = ref<Preset>('month')
const panel = ref<Panel>('list')
const customFrom = ref(monthEdges(0).from)
const customTo = ref(monthEdges(0).to)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const formError = ref('')
const rangeError = ref('')
const data = ref<LedgerBook | null>(null)
const editingId = ref<string | null>(null)
const form = reactive({
  kind: 'expense' as Kind,
  category: 'food',
  amount: '',
  occurred_on: today(),
  note: '',
  version: 1,
})

const span = computed(() => {
  if (preset.value === 'last') return monthEdges(-1)
  if (preset.value === 'week') return recentDays(7)
  if (preset.value === 'thirty') return recentDays(30)
  if (preset.value === 'custom') return { from: customFrom.value, to: customTo.value }
  return monthEdges(0)
})
const categories = computed(() => data.value?.catalog[form.kind] || [])
const expenseStats = computed(() => (data.value?.categories || []).filter((item) => item.kind === 'expense'))
const incomeStats = computed(() => (data.value?.categories || []).filter((item) => item.kind === 'income'))
const maxDay = computed(() => Math.max(1, ...(data.value?.days || []).map((day) => Math.max(day.expense_cents, day.income_cents))))
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

function daySpent(items: LedgerEntry[]): string {
  return yuan(items.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amount_cents, 0))
}

async function load(): Promise<void> {
  const { from, to } = span.value
  if (!from || !to || from > to) {
    rangeError.value = '请选择开始和结束日期'
    return
  }
  const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
  if (length > 366) {
    rangeError.value = '区间最长 366 天'
    return
  }
  rangeError.value = ''
  loading.value = true
  error.value = ''
  try {
    data.value = await listLedger({ from, to })
  } catch (cause) {
    error.value = cause instanceof SiteApiError ? cause.message : '暂时无法加载记账'
  } finally {
    loading.value = false
  }
}

function choosePreset(next: Preset): void {
  preset.value = next
  void load()
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
    const savedOn = form.occurred_on
    resetForm()
    if (savedOn < span.value.from || savedOn > span.value.to) {
      preset.value = 'custom'
      customFrom.value = savedOn
      customTo.value = savedOn
    }
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
    <PageHeading title="记账" description="按一段时间查看收支。明细是连续流水，统计按分类和日期汇总。" />
    <PageState v-if="loading && !data" kind="loading" title="正在加载这段时间的账…" />
    <PageState v-else-if="error && !data" kind="error" title="暂时无法加载记账" :description="error" retry @retry="load" />
    <template v-else-if="data">
      <div class="range-bar">
        <div class="presets" role="group" aria-label="时间区间">
          <button
            v-for="item in PRESETS"
            :key="item.id"
            type="button"
            :class="{ 'is-selected': preset === item.id }"
            @click="choosePreset(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
        <div v-if="preset === 'custom'" class="custom-range">
          <input v-model="customFrom" type="date" aria-label="开始日期" @change="load" />
          <span>至</span>
          <input v-model="customTo" type="date" aria-label="结束日期" @change="load" />
        </div>
        <p v-if="rangeError" class="form-error" role="alert">{{ rangeError }}</p>
      </div>

      <section class="band" :aria-label="`${data.from} 至 ${data.to}`">
        <div>
          <span>支出</span>
          <strong class="is-expense">{{ data.summary.expense }}</strong>
        </div>
        <div>
          <span>收入</span>
          <strong class="is-income">{{ data.summary.income }}</strong>
        </div>
        <div>
          <span>结余</span>
          <strong :class="data.summary.balance_cents < 0 ? 'is-expense' : 'is-income'">{{ data.summary.balance }}</strong>
        </div>
        <p>{{ data.from }} 至 {{ data.to }}</p>
      </section>

      <div class="view-switch" role="tablist">
        <button type="button" role="tab" :aria-selected="panel === 'list'" :class="{ 'is-selected': panel === 'list' }" @click="panel = 'list'">明细</button>
        <button type="button" role="tab" :aria-selected="panel === 'stats'" :class="{ 'is-selected': panel === 'stats' }" @click="panel = 'stats'">统计</button>
      </div>

      <form class="composer" @submit.prevent="submit">
        <div class="kind-switch" role="group" aria-label="收支类型">
          <button type="button" :class="{ 'is-selected': form.kind === 'expense' }" @click="form.kind = 'expense'">支出</button>
          <button type="button" :class="{ 'is-selected': form.kind === 'income' }" @click="form.kind = 'income'">收入</button>
        </div>
        <label>
          金额
          <input v-model="form.amount" inputmode="decimal" placeholder="28.50" required />
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

      <section v-if="panel === 'stats'" class="stats">
        <article>
          <h2>支出构成</h2>
          <p v-if="!expenseStats.length" class="muted">这段时间没有支出。</p>
          <div v-for="item in expenseStats" :key="item.category" class="stat-row">
            <span>{{ item.category_label }}</span>
            <span class="track"><span class="fill is-expense-bar" :style="{ width: `${Math.max(item.share, 2)}%` }" /></span>
            <strong>{{ item.amount }} · {{ item.share }}%</strong>
          </div>
        </article>
        <article>
          <h2>收入构成</h2>
          <p v-if="!incomeStats.length" class="muted">这段时间没有收入。</p>
          <div v-for="item in incomeStats" :key="item.category" class="stat-row">
            <span>{{ item.category_label }}</span>
            <span class="track"><span class="fill is-income-bar" :style="{ width: `${Math.max(item.share, 2)}%` }" /></span>
            <strong>{{ item.amount }} · {{ item.share }}%</strong>
          </div>
        </article>
        <article>
          <h2>按日</h2>
          <p v-if="!data.days.length" class="muted">这段时间还没有账。</p>
          <div v-for="day in data.days" :key="day.date" class="day-stat">
            <span>{{ dayLabel(day.date) }}</span>
            <span class="tracks">
              <span class="track"><span class="fill is-expense-bar" :style="{ width: `${(day.expense_cents / maxDay) * 100}%` }" /></span>
              <span class="track"><span class="fill is-income-bar" :style="{ width: `${(day.income_cents / maxDay) * 100}%` }" /></span>
            </span>
            <strong>
              <em class="is-expense">-{{ day.expense }}</em>
              <em class="is-income">+{{ day.income }}</em>
            </strong>
          </div>
        </article>
      </section>

      <section v-else class="sheet">
        <p v-if="!groups.length" class="empty-month">这段时间还没有账。先记一笔午餐吧。</p>
        <template v-for="[day, items] in groups" :key="day">
          <div class="day-label">
            <span>{{ dayLabel(day) }}</span>
            <span>支出 {{ daySpent(items) }}</span>
          </div>
          <article v-for="item in items" :key="item.id" class="entry">
            <span class="mark" :class="item.kind" aria-hidden="true" />
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
          </article>
        </template>
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
.range-bar,
.view-switch,
.kind-switch,
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.presets button,
.view-switch button,
.kind-switch button,
.row-actions button {
  min-height: 36px;
  padding: 6px 14px;
  border: 1px solid var(--site-border);
  border-radius: 999px;
  background: transparent;
  color: var(--site-text);
  font: inherit;
}
.presets button.is-selected,
.view-switch button.is-selected,
.kind-switch button.is-selected {
  color: white;
  background: var(--site-accent);
  border-color: var(--site-accent);
}
.custom-range {
  display: flex;
  gap: 8px;
  align-items: center;
}
.custom-range input,
.composer input,
.composer select {
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid var(--site-border);
  border-radius: 8px;
  background: var(--site-surface);
  font: inherit;
}
.band,
.composer,
.stats article,
.sheet {
  background: var(--site-surface);
  border: 1px solid var(--site-border);
  border-radius: 12px;
}
.band {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 18px;
  margin: 16px 0;
  padding: 18px 20px 14px;
}
.band span,
.band p,
.muted,
.empty-month,
.day-label,
.entry p {
  color: var(--site-muted);
}
.band strong {
  display: block;
  margin-top: 4px;
  font-size: 26px;
  font-weight: 650;
}
.band p,
.empty-month {
  grid-column: 1 / -1;
  margin: 4px 0 0;
  font-size: 13px;
}
.view-switch {
  margin-bottom: 14px;
}
.composer {
  display: grid;
  grid-template-columns: 120px 1fr 1fr 1fr;
  gap: 12px;
  margin-bottom: 18px;
  padding: 16px;
}
.composer label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--site-muted);
}
.kind-switch,
.note-field,
.form-actions,
.form-error {
  grid-column: 1 / -1;
}
.form-error {
  margin: 0;
  color: var(--site-danger);
}
.stats {
  display: grid;
  gap: 12px;
}
.stats article {
  padding: 16px 18px;
}
.stats h2 {
  margin: 0 0 12px;
  font-size: 15px;
}
.stat-row,
.day-stat {
  display: grid;
  grid-template-columns: 72px 1fr auto;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  font-size: 13px;
}
.tracks {
  display: grid;
  gap: 4px;
}
.track {
  display: block;
  height: 8px;
  overflow: hidden;
  background: var(--site-soft);
  border-radius: 99px;
}
.fill {
  display: block;
  height: 100%;
  border-radius: inherit;
}
.is-expense-bar { background: #c46a5d; }
.is-income-bar { background: #3d8b66; }
.day-stat strong {
  display: grid;
  justify-items: end;
  font-weight: 600;
}
.day-stat em {
  font-style: normal;
}
.sheet {
  overflow: hidden;
}
.empty-month {
  padding: 28px 18px;
}
.day-label {
  display: flex;
  justify-content: space-between;
  padding: 14px 16px 4px;
  font-size: 12px;
}
.entry {
  display: grid;
  grid-template-columns: 8px 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
}
.entry + .entry,
.day-label + .entry {
  border-top: 1px solid #eef2ec;
}
.mark {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.mark.expense { background: #c46a5d; }
.mark.income { background: #3d8b66; }
.entry p {
  margin: 2px 0 0;
  font-size: 13px;
}
.row-actions button {
  min-height: 32px;
  padding: 4px 8px;
  border: 0;
  color: var(--site-muted);
}
.is-expense { color: #8a2b22; font-weight: 650; }
.is-income { color: #1f6b45; font-weight: 650; }
@media (max-width: 760px) {
  .ledger-page { padding-block: 32px 48px; }
  .band,
  .composer,
  .stat-row,
  .day-stat { grid-template-columns: 1fr; }
  .entry { grid-template-columns: 8px 1fr auto; }
  .row-actions { grid-column: 2 / -1; }
}
</style>
