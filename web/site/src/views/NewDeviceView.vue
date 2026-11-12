<script setup lang="ts">
import { ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import PageHeading from '../components/PageHeading.vue'
import DeviceForm from '../components/DeviceForm.vue'
import { createDevice, type DeviceInput } from '../api/devices'
const router = useRouter()
const busy = ref(false)
const error = ref('')
onBeforeRouteLeave((to) => !busy.value || to.name === 'site-login')
async function save(values: DeviceInput) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const device = await createDevice(values)
    busy.value = false
    await router.replace({ name: 'site-device-detail', params: { id: device.id } })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败，请稍后重试'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="new-device-page">
    <RouterLink class="back-link" to="/app">← 我的设备</RouterLink
    ><PageHeading title="新增设备" description="只需一个名称，其他信息可以以后慢慢补齐。" />
    <div class="new-device-layout">
      <section class="form-panel" aria-label="设备录入表单">
        <DeviceForm :busy="busy" :error="error" @submit="save" @cancel="router.push('/app')" />
      </section>
      <aside class="form-help">
        <img src="/icons/notebook-pen.svg" width="32" height="32" alt="" />
        <h2>不必一次填完整。</h2>
        <p>名称是唯一必填项。购买日期、保修日期暂时不确定，可以先留空。</p>
        <p>保存设备后，可以在详情页添加维护计划，或补充一条维护记录。</p>
        <p class="help-note">
          <img src="/icons/info.svg" width="18" height="18" alt="" />不需要上传发票或照片。
        </p>
      </aside>
    </div>
  </div>
</template>
<style scoped>
.new-device-page {
  width: min(1140px, calc(100% - var(--site-gutter) * 2));
  margin-inline: auto;
  padding-block: 40px 64px;
}
.back-link {
  display: inline-block;
  margin-bottom: 28px;
  font-size: 14px;
  color: var(--site-muted);
}
.back-link:hover {
  text-decoration: underline;
}
.new-device-layout {
  display: grid;
  grid-template-columns: minmax(0, 740px) minmax(0, 1fr);
  gap: 36px;
}
.form-panel {
  padding: 28px;
  border: 1px solid var(--site-border);
  border-radius: 10px;
  background: var(--site-surface);
}
.form-help {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 20px;
  padding-top: 24px;
}
.form-help p {
  color: var(--site-muted);
}
.form-help .help-note {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  background: var(--site-soft);
  border-radius: 8px;
  font-size: 14px;
}
.help-note img {
  flex-shrink: 0;
}
@media (max-width: 1000px) {
  .new-device-layout {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 28px;
  }
}
@media (max-width: 760px) {
  .new-device-page {
    padding-block: 28px 40px;
  }
  .new-device-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
  }
  .form-panel {
    padding: 22px;
  }
  .form-help {
    padding-top: 0;
  }
}
</style>
