<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SiteButton from '../components/SiteButton.vue'

const route = useRoute()
const router = useRouter()
const privacy = computed(() => route.name === 'site-privacy')
const page = computed(() =>
  privacy.value
    ? {
        category: 'PRIVACY / 隐私与数据',
        title: '你的记录，你来掌握。',
        description: '了解我们需要什么信息、为什么需要，以及你可以如何管理自己的数据。',
        notice: '政策草案 · 正式上线前需补齐真实运营者、联系渠道及审核后的政策。',
        sections: [
          {
            id: 'privacy-collection',
            title: '收集什么',
            body: '仅收集登录必要信息，以及你主动录入的设备、日期和维护记录。不要求手机号、邮箱、身份证、位置或照片。',
          },
          {
            id: 'privacy-retention',
            title: '用途与保存',
            body: '用于提供私人台账、会话及必要安全保护。台账在账户存续期间保留，可自行导出或注销。备份保留周期及日志保存规则将在正式上线前确认并补充。',
          },
          {
            id: 'privacy-choices',
            title: '你的选择',
            body: '你可以随时修改或删除设备、导出完整数据、注销账户。密码和恢复码同时丢失时，无法保证恢复。',
          },
          {
            id: 'privacy-demo',
            title: '示例如何处理数据',
            body: '示例体验使用合成数据，不请求台账接口，不写 Cookie 或本地存储，不保存真实密码，刷新后重置。',
          },
        ],
      }
    : {
        category: 'ABOUT / 关于设备台账',
        title: '把设备的后续事项记清楚。',
        description: '为个人整理设备的保修与维护信息，让每一次购买之后，都有迹可循。',
        notice: '项目开发中 · 邀请制试用；当前处于本地开发与原型评审阶段。',
        sections: [
          {
            id: 'about-purpose',
            title: '为什么做这个项目',
            body: '设备买回来以后，保修、清洁和维护往往散落在不同地方。设备台账把记录、待办和历史连起来，帮助你在需要时找得到。',
          },
          {
            id: 'about-scope',
            title: '第一版的范围',
            body: '设备名称即可开始。支持按天维护、站内待办、维护历史和手动日历导出。第一版没有支付、附件、公开分享或自动站外通知。',
          },
          {
            id: 'about-boundaries',
            title: '清楚的产品边界',
            body: '这里提供私人记录，不提供维修撮合、厂家承诺或自动保修判断。保修日期和维护周期由你填写，以实际信息和厂家规则为准。',
          },
          {
            id: 'about-status',
            title: '项目状态与反馈',
            body: '目前处于本地开发与原型评审阶段，尚未备案，需求尚未经过真实用户验证。正式上线前将补充真实联系渠道。',
          },
        ],
      },
)
async function goToSection(id: string) {
  await router.push({ path: route.path, hash: `#${id}` })
  await nextTick()
  const section = document.getElementById(id)
  section?.scrollIntoView({ block: 'start' })
  section?.focus({ preventScroll: true })
}
</script>

<template>
  <article class="information-page" aria-labelledby="information-title">
    <RouterLink class="back-link" to="/">← 返回首页</RouterLink>
    <header class="information-intro">
      <p class="information-category">{{ page.category }}</p>
      <h1 id="information-title">{{ page.title }}</h1>
      <p class="information-description">{{ page.description }}</p>
    </header>
    <p class="information-notice">
      <img src="/icons/info.svg" width="18" height="18" alt="" /><span>{{ page.notice }}</span>
    </p>
    <div class="information-layout">
      <nav class="page-directory" aria-labelledby="directory-title">
        <h2 id="directory-title">本页内容</h2>
        <ol>
          <li v-for="(section, index) in page.sections" :key="section.id">
            <a
              :href="`#${section.id}`"
              :aria-current="route.hash === `#${section.id}` ? 'location' : undefined"
              @click.prevent="goToSection(section.id)"
              ><span aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span
              >{{ section.title }}</a
            >
          </li>
        </ol>
      </nav>
      <div class="information-body">
        <section
          v-for="section in page.sections"
          :id="section.id"
          :key="section.id"
          tabindex="-1"
          :aria-labelledby="`${section.id}-title`"
        >
          <h2 :id="`${section.id}-title`">{{ section.title }}</h2>
          <p>{{ section.body }}</p>
        </section>
      </div>
    </div>
    <div class="information-actions">
      <SiteButton to="/">返回首页</SiteButton
      ><SiteButton v-if="privacy" to="/app/account">账户与数据</SiteButton
      ><SiteButton v-else to="/demo" variant="primary">体验示例</SiteButton>
    </div>
  </article>
</template>

<style scoped>
.information-page {
  width: min(1140px, calc(100% - var(--site-gutter) * 2));
  margin-inline: auto;
  padding-block: 52px 72px;
}
.back-link {
  display: inline-block;
  color: var(--site-muted);
  font-size: 14px;
  margin-bottom: 36px;
}
.back-link:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.information-intro {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 36px;
}
.information-category {
  color: #61765f;
  font-size: 13px;
}
.information-intro h1 {
  font-size: 36px;
  line-height: 1.6;
}
.information-description {
  font-size: 17px;
  color: #647767;
}
.information-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  background: #eff4ec;
  color: #597050;
  border-radius: var(--site-radius);
  font-size: 14px;
  margin-bottom: 36px;
}
.information-notice img {
  flex-shrink: 0;
}
.information-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 64px;
  align-items: start;
}
.page-directory {
  padding-top: 8px;
}
.page-directory h2 {
  font-size: 13px;
  font-weight: 400;
  color: var(--site-muted);
  margin-bottom: 18px;
}
.page-directory ol {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.page-directory a {
  display: inline-flex;
  align-items: baseline;
  gap: 12px;
  color: #617961;
  font-size: 14px;
}
.page-directory a:hover,
.page-directory a[aria-current='location'] {
  color: var(--site-accent);
  text-decoration: underline;
  text-underline-offset: 4px;
}
.page-directory a[aria-current='location'] {
  font-weight: 600;
}
.page-directory a span {
  font-variant-numeric: tabular-nums;
}
.information-body {
  display: flex;
  flex-direction: column;
  gap: 32px;
  min-width: 0;
}
.information-body section {
  padding-bottom: 26px;
  border-bottom: 1px solid #e0e7dc;
  scroll-margin-top: 24px;
}
.information-body h2 {
  font-size: 22px;
  line-height: 1.6;
  margin-bottom: 12px;
}
.information-body p {
  color: #657767;
  font-size: 16px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.information-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 36px;
}
@media (max-width: 900px) {
  .information-layout {
    grid-template-columns: 190px minmax(0, 1fr);
    gap: 36px;
  }
  .information-intro h1 {
    font-size: 32px;
  }
}
@media (max-width: 680px) {
  .information-page {
    padding-block: 32px 48px;
  }
  .back-link {
    margin-bottom: 28px;
  }
  .information-intro {
    gap: 12px;
    margin-bottom: 28px;
  }
  .information-intro h1 {
    font-size: 28px;
    line-height: 1.45;
  }
  .information-description {
    font-size: 16px;
  }
  .information-notice {
    align-items: flex-start;
    font-size: 13px;
    margin-bottom: 28px;
  }
  .information-notice img {
    margin-top: 2px;
  }
  .information-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
  }
  .page-directory {
    padding: 0 0 24px;
    border-bottom: 1px solid var(--site-border);
  }
  .page-directory ol {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .page-directory a {
    gap: 8px;
    align-items: flex-start;
  }
  .information-body h2 {
    font-size: 21px;
  }
}
@media (max-width: 360px) {
  .page-directory ol {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .information-intro h1 {
    font-size: 25px;
  }
}
</style>
