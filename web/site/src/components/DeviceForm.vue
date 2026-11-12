<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import SiteButton from './SiteButton.vue'
import type { DeviceInput, DeviceSummary } from '../api/devices'
import { deviceCategories, ledgerToday, validateDevice } from '../utils/device-form'
const props = withDefaults(
  defineProps<{ device?: DeviceSummary; busy?: boolean; error?: string }>(),
  { busy: false, error: '' },
)
const emit = defineEmits<{ submit: [value: DeviceInput]; cancel: [] }>()
const values = reactive<DeviceInput>({
  name: props.device?.name || '',
  category: props.device?.category || 'other',
  model: props.device?.model || '',
  purchased_on: props.device?.purchased_on || '',
  warranty_until: props.device?.warranty_until || '',
  note: props.device?.note || '',
})
const localError = ref('')
const errorElement = ref<HTMLElement | null>(null)
watch(
  () => props.error,
  async (value) => {
    if (value) {
      await nextTick()
      errorElement.value?.focus()
    }
  },
)
async function submit() {
  if (props.busy) return
  localError.value = validateDevice(values)
  if (localError.value) {
    await nextTick()
    errorElement.value?.focus()
    return
  }
  emit('submit', {
    ...values,
    name: values.name.trim(),
    model: values.model.trim(),
    note: values.note.trim(),
  })
}
</script>
<template>
  <form class="device-form" @submit.prevent="submit" :aria-busy="busy">
    <fieldset :disabled="busy">
      <legend>基本信息</legend>
      <div class="form-field">
        <label for="device-name">设备名称 *</label
        ><input
          id="device-name"
          v-model="values.name"
          name="name"
          required
          maxlength="80"
          placeholder="例如：客厅空气净化器"
        />
      </div>
      <div class="form-columns">
        <div class="form-field">
          <label for="device-category">设备类别</label
          ><select id="device-category" v-model="values.category" name="category">
            <option
              v-for="category in deviceCategories"
              :key="category.value"
              :value="category.value"
            >
              {{ category.label }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="device-model">型号</label
          ><input
            id="device-model"
            v-model="values.model"
            name="model"
            maxlength="80"
            placeholder="选填，填写品牌或型号"
          />
        </div>
      </div>
      <div class="form-columns">
        <div class="form-field">
          <label for="device-purchased">购买日期</label
          ><input
            id="device-purchased"
            v-model="values.purchased_on"
            name="purchased_on"
            type="date"
            :max="ledgerToday()"
          />
        </div>
        <div class="form-field">
          <label for="device-warranty">保修截止日期</label
          ><input
            id="device-warranty"
            v-model="values.warranty_until"
            name="warranty_until"
            type="date"
            :min="values.purchased_on || undefined"
          />
        </div>
      </div>
      <div class="form-field">
        <label for="device-note">备注</label
        ><textarea
          id="device-note"
          v-model="values.note"
          name="note"
          maxlength="500"
          rows="4"
          placeholder="补充使用、保修或维护相关信息（选填）"
        />
        <p class="character-count">{{ values.note.length }} / 500</p>
      </div>
    </fieldset>
    <p v-if="localError || error" ref="errorElement" class="form-error" role="alert" tabindex="-1">
      {{ localError || error }}
    </p>
    <div class="form-actions">
      <SiteButton :disabled="busy" @click="emit('cancel')">取消</SiteButton
      ><SiteButton type="submit" variant="primary" :loading="busy">{{
        busy ? '正在保存…' : '保存设备'
      }}</SiteButton>
    </div>
  </form>
</template>
<style scoped>
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
legend {
  font-size: 20px;
  font-weight: 600;
  padding: 0;
  margin-bottom: 24px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  margin-bottom: 24px;
}
label {
  font-size: 14px;
}
input,
select,
textarea {
  width: 100%;
  min-width: 0;
  min-height: 48px;
  padding: 11px 14px;
  border: 1px solid var(--site-border);
  border-radius: 7px;
  background: var(--site-surface);
  color: var(--site-text);
}
textarea {
  resize: vertical;
}
input::placeholder,
textarea::placeholder {
  color: var(--site-muted);
}
.form-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.character-count {
  text-align: right;
  color: var(--site-muted);
  font-size: 12px;
}
.form-error {
  color: var(--site-danger);
  font-size: 14px;
  margin-bottom: 20px;
  overflow-wrap: anywhere;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  border-top: 1px solid var(--site-border);
  padding-top: 20px;
}
@media (max-width: 600px) {
  .form-columns {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  input,
  select,
  textarea {
    font-size: 16px;
  }
}
</style>
