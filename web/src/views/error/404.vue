<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Back, House } from '@element-plus/icons-vue'

const router = useRouter()
</script>

<template>
  <div class="not-found">
    <div class="not-found__card">
      <div class="not-found__code">404</div>
      <h1>页面不存在</h1>
      <p>链接可能已失效，或者你访问了尚未开放的页面。</p>
      <div class="not-found__actions">
        <el-button :icon="Back" @click="router.back()">返回上一页</el-button>
        <el-button type="primary" :icon="House" @click="router.replace('/dashboard')">
          回到运营概览
        </el-button>
      </div>
    </div>
    <p class="not-found__foot">设备台账 · 管理后台</p>
  </div>
</template>

<style scoped lang="scss">
.not-found {
  display: flex;
  flex-direction: column;
  gap: 24px;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 32px;
  background:
    radial-gradient(circle at 50% 0%, rgba(47, 107, 255, 0.08), transparent 45%), var(--app-bg);
}

.not-found__card {
  width: 100%;
  max-width: 460px;
  padding: 48px 40px;
  text-align: center;
  background: #fff;
  border: 1px solid var(--app-border);
  border-radius: 20px;
  box-shadow: var(--app-shadow);

  h1 {
    margin: 10px 0 8px;
    color: var(--app-text);
    font-size: 24px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  p {
    margin: 0;
    color: var(--app-muted);
    font-size: 13px;
  }
}

.not-found__code {
  color: transparent;
  font-size: 68px;
  font-weight: 750;
  letter-spacing: -0.04em;
  line-height: 1;
  background: linear-gradient(135deg, #4f8bff, #1e4fd8);
  background-clip: text;
  -webkit-background-clip: text;
}

.not-found__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-top: 28px;
}

.not-found__foot {
  margin: 0;
  color: #a2abba;
  font-size: 11px;
  letter-spacing: 0.08em;
}
</style>
