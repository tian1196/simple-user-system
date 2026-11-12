<script setup lang="ts">
import SiteButton from '../components/SiteButton.vue'

const metrics = [
  { value: '03', label: '已记录设备' },
  { value: '02', label: '待维护事项' },
  { value: '01', label: '保修将到期' },
]
const sampleItems = [
  {
    icon: 'air-vent',
    name: '空气净化器',
    detail: '滤芯更换 · 11月02日',
    status: '逾期 3 天',
    overdue: true,
  },
  {
    icon: 'camera',
    name: '微单相机',
    detail: '保修截止 · 11月17日',
    status: '还有 12 天',
    overdue: false,
  },
  {
    icon: 'laptop',
    name: '工作笔记本',
    detail: '清洁检查 · 11月13日',
    status: '还有 8 天',
    overdue: false,
  },
]
const features = [
  {
    number: '01',
    icon: 'notebook-pen',
    title: '记录设备',
    description: '仅名称必填。购买日、型号和保修日，知道多少填多少。',
  },
  {
    number: '02',
    icon: 'refresh-cw',
    title: '安排维护',
    description: '按天设置维护周期，完成一次，留下记录，也安排好下一次。',
  },
  {
    number: '03',
    icon: 'calendar-days',
    title: '带到日历',
    description: '手动导出未来事项，在自己的日历中设置提醒，按自己的节奏处理。',
  },
]
const privacyPoints = [
  { icon: 'user-round-check', text: '无需手机号或邮箱，用邀请开启记录' },
  { icon: 'shield-check', text: '不上传发票或照片，减少不必要的信息' },
  { icon: 'download', text: '保留自己的数据，也记得定期备份' },
]
</script>

<template>
  <div class="home-page">
    <section id="home-hero" class="home-hero site-container" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="hero-eyebrow">
          <img
            src="/icons/circle-dot.svg"
            width="14"
            height="14"
            alt=""
          />为日常物品，留一份长久的记录
        </p>
        <h1 id="home-title">设备买回来以后，<br />也值得有一份记录。</h1>
        <p class="hero-description">
          把保修日期、维护计划和处理记录放在一起。<br
            class="desktop-break"
          />需要时找得到，到期时看得清。
        </p>
        <div class="hero-actions">
          <SiteButton to="/demo" variant="primary"
            >体验示例<img
              class="inverse-icon"
              src="/icons/arrow-right.svg"
              width="18"
              height="18"
              alt=""
          /></SiteButton>
          <SiteButton to="/register">已有邀请，开始使用</SiteButton>
        </div>
        <ul class="hero-notes" aria-label="试用说明">
          <li>免费邀请试用</li>
          <li>无需手机号</li>
          <li>不上传发票或照片</li>
        </ul>
      </div>

      <section class="ledger-stage" aria-label="设备台账示例预览">
        <div class="ledger-window">
          <div class="ledger-heading">
            <h2>我的设备</h2>
            <span class="sample-label">示例数据</span>
          </div>
          <dl class="ledger-metrics">
            <div v-for="metric in metrics" :key="metric.label">
              <dt>{{ metric.label }}</dt>
              <dd>{{ metric.value }}</dd>
            </div>
          </dl>
          <div class="upcoming-heading">
            <h3>近期事项</h3>
            <RouterLink to="/demo" aria-label="查看全部示例事项">查看全部 ↗</RouterLink>
          </div>
          <ul class="sample-items">
            <li v-for="item in sampleItems" :key="item.name" class="sample-item">
              <span class="device-symbol"
                ><img :src="`/icons/${item.icon}.svg`" width="20" height="20" alt=""
              /></span>
              <div class="sample-info">
                <p class="device-name">{{ item.name }}</p>
                <p class="device-detail">{{ item.detail }}</p>
              </div>
              <span class="due-label" :class="{ 'is-overdue': item.overdue }">{{
                item.status
              }}</span>
            </li>
          </ul>
        </div>
        <p class="calendar-note">
          <img src="/icons/calendar-check.svg" width="18" height="18" alt="" /><span
            >下一次维护，也可以记在你自己的日历里。</span
          >
        </p>
      </section>
    </section>

    <section id="home-features" class="home-features" aria-labelledby="features-title">
      <div class="site-container">
        <div class="features-heading">
          <h2 id="features-title">少一点遗忘，多一点从容。</h2>
          <p>从记录到维护，让设备的日常有迹可循。</p>
        </div>
        <ol class="feature-list">
          <li v-for="feature in features" :key="feature.number">
            <div class="feature-symbol">
              <img :src="`/icons/${feature.icon}.svg`" width="26" height="26" alt="" /><span>{{
                feature.number
              }}</span>
            </div>
            <h3>{{ feature.title }}</h3>
            <p>{{ feature.description }}</p>
          </li>
        </ol>
      </div>
    </section>

    <section id="home-privacy" class="home-privacy site-container" aria-labelledby="privacy-title">
      <div class="privacy-copy">
        <p class="privacy-eyebrow">简单记录，安心使用</p>
        <h2 id="privacy-title">你的物品，你的私人台账。</h2>
        <p class="privacy-description">第一版专注私人记录，不提供维修建议或保修承诺。</p>
      </div>
      <ul class="privacy-points">
        <li v-for="point in privacyPoints" :key="point.icon">
          <img :src="`/icons/${point.icon}.svg`" width="20" height="20" alt="" /><span>{{
            point.text
          }}</span>
        </li>
      </ul>
    </section>

    <section id="home-start" class="home-start" aria-labelledby="start-title">
      <div class="site-container start-inner">
        <div>
          <h2 id="start-title">从你的第一台设备开始。</h2>
          <p>先看看示例，再决定如何建立自己的台账。</p>
        </div>
        <SiteButton to="/demo"
          >体验示例<img src="/icons/arrow-right.svg" width="18" height="18" alt=""
        /></SiteButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  --home-heading: #203d31;
  --home-stage: #eaf0e5;
  --home-note: #567048;
  --home-secondary: #6c786e;
}
.home-hero {
  display: grid;
  grid-template-columns: minmax(0, 520px) minmax(0, 568px);
  align-items: center;
  gap: 60px;
  padding-block: 70px 64px;
}
.hero-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 22px;
  min-width: 0;
}
.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  background: #ebf0e6;
  color: #4d6749;
  border-radius: 30px;
  font-size: 13px;
}
.hero-eyebrow img {
  flex-shrink: 0;
}
.hero-copy h1 {
  font-size: clamp(34px, 3.2vw, 46px);
  line-height: 1.38;
  font-weight: 600;
  color: var(--home-heading);
  letter-spacing: 0;
}
.hero-description {
  font-size: 17px;
  color: var(--home-secondary);
  line-height: 1.6;
}
.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.hero-actions :deep(.site-button) {
  padding: 13px 22px;
  gap: 12px;
  font-size: 15px;
}
.inverse-icon {
  filter: brightness(0) invert(1);
}
.hero-notes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 0;
  margin: 0;
  color: #677568;
  font-size: 13px;
  list-style: none;
}
.hero-notes li + li::before {
  content: '·';
  margin-right: 12px;
}
.ledger-stage {
  min-width: 0;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--home-stage);
  border-radius: 18px;
}
.ledger-window {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
  border: 1px solid #dce5d6;
  background: var(--site-surface);
  border-radius: 12px;
  box-shadow: 0 12px 30px #203d3110;
}
.ledger-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.ledger-heading h2 {
  font-size: 18px;
  font-weight: 400;
}
.sample-label {
  background: #f0f3eb;
  padding: 3px 9px;
  border-radius: 4px;
  font-size: 13px;
  color: #627354;
  white-space: nowrap;
}
.ledger-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}
.ledger-metrics > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ledger-metrics dt {
  order: 1;
  font-size: 13px;
  color: #667466;
}
.ledger-metrics dd {
  margin: 0;
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}
.upcoming-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid #edf0e9;
  gap: 12px;
  font-size: 13px;
}
.upcoming-heading h3 {
  font-size: inherit;
  font-weight: 400;
  margin: 0;
}
.upcoming-heading a {
  color: #667466;
}
.upcoming-heading a:hover {
  color: var(--site-accent);
  text-decoration: underline;
}
.sample-items {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.sample-item {
  display: flex;
  align-items: center;
  gap: 12px;
}
.device-symbol {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  background: #f3f5ef;
  border-radius: 8px;
  flex-shrink: 0;
}
.device-symbol img {
  display: block;
}
.sample-info {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}
.device-name,
.device-detail {
  overflow-wrap: anywhere;
}
.device-detail {
  color: #6b7867;
  margin-top: 1px;
}
.due-label {
  flex-shrink: 0;
  padding: 4px 8px;
  color: #577047;
  background: #f0f4e9;
  border-radius: 5px;
  font-size: 13px;
}
.due-label.is-overdue {
  color: #92562e;
  background: #fbeee2;
}
.calendar-note {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--home-note);
  font-size: 12px;
}
.calendar-note img {
  flex-shrink: 0;
}
.home-features {
  padding-block: 48px 64px;
  background: var(--site-surface);
}
.features-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  margin-bottom: 38px;
}
.home-page h2 {
  font-size: 28px;
  line-height: 1.6;
}
.home-page .ledger-heading h2 {
  font-size: 18px;
}
.features-heading > p {
  font-size: 14px;
  color: #647267;
}
.feature-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 48px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.feature-list li {
  min-width: 0;
}
.feature-symbol {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.feature-symbol span {
  color: #6e7d6e;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.feature-list h3 {
  font-size: 20px;
  font-weight: 600;
  margin: 14px 0;
}
.feature-list p {
  font-size: 15px;
  color: #647267;
}
.home-privacy {
  display: grid;
  grid-template-columns: 500fr 688fr;
  gap: 60px;
  align-items: center;
  padding-block: 52px;
}
.privacy-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.privacy-eyebrow {
  color: #5c785d;
  font-size: 13px;
}
.privacy-description {
  color: #627165;
  font-size: 14px;
}
.privacy-points {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.privacy-points li {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: #506557;
}
.privacy-points img {
  flex-shrink: 0;
}
.home-start {
  background: #254f3e;
  color: white;
  padding-block: 42px;
}
.start-inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 32px;
}
.home-page .home-start h2 {
  font-size: 27px;
}
.home-start p {
  margin-top: 6px;
  font-size: 14px;
  color: #c9d9cf;
}
.home-start :deep(.site-button) {
  flex-shrink: 0;
  padding: 14px 24px;
  gap: 20px;
  font-size: 15px;
}
@media (max-width: 1100px) {
  .home-hero {
    gap: 32px;
    grid-template-columns: 1fr 1fr;
  }
  .hero-copy h1 {
    font-size: 36px;
  }
  .desktop-break {
    display: none;
  }
  .ledger-stage {
    padding: 18px;
  }
  .ledger-window {
    padding: 20px;
  }
  .sample-item {
    gap: 8px;
  }
  .device-symbol {
    padding: 8px;
  }
  .due-label {
    padding: 4px 6px;
  }
  .home-privacy {
    gap: 32px;
  }
}
@media (max-width: 900px) {
  .home-hero {
    grid-template-columns: 1fr;
    padding-block: 48px;
    gap: 40px;
  }
  .hero-copy h1 {
    font-size: clamp(30px, 5.2vw, 46px);
  }
  .hero-description {
    max-width: 520px;
  }
  .ledger-stage {
    width: 100%;
    max-width: 568px;
    justify-self: center;
  }
  .features-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .feature-list {
    gap: 28px;
  }
  .home-privacy {
    grid-template-columns: 1fr;
    gap: 28px;
  }
}
@media (max-width: 600px) {
  .hero-eyebrow {
    font-size: 12px;
  }
  .hero-description {
    font-size: 16px;
  }
  .hero-notes {
    gap: 4px 8px;
    font-size: 12px;
  }
  .hero-notes li + li::before {
    margin-right: 8px;
  }
  .hero-actions {
    width: 100%;
    gap: 10px;
  }
  .hero-actions :deep(.site-button) {
    font-size: 14px;
    padding: 12px 16px;
  }
  .ledger-stage {
    padding: 16px;
    gap: 14px;
  }
  .ledger-window {
    padding: 18px 14px;
  }
  .sample-label {
    font-size: 12px;
  }
  .ledger-metrics {
    gap: 8px;
  }
  .ledger-metrics dt {
    font-size: 12px;
  }
  .sample-info,
  .due-label {
    font-size: 12px;
  }
  .sample-items {
    gap: 18px;
  }
  .sample-item {
    gap: 10px;
  }
  .device-symbol {
    padding: 7px;
  }
  .calendar-note {
    align-items: flex-start;
  }
  .home-features {
    padding-block: 36px 40px;
  }
  .home-page h2 {
    font-size: 24px;
  }
  .home-page .ledger-heading h2 {
    font-size: 18px;
  }
  .features-heading {
    margin-bottom: 28px;
  }
  .feature-list {
    grid-template-columns: 1fr;
    gap: 28px;
  }
  .feature-list li + li {
    padding-top: 24px;
    border-top: 1px solid var(--site-border);
  }
  .feature-list h3 {
    margin-block: 12px;
  }
  .home-privacy {
    padding-block: 40px;
  }
  .start-inner {
    align-items: flex-start;
    flex-direction: column;
    gap: 24px;
  }
  .home-page .home-start h2 {
    font-size: 24px;
  }
  .home-start {
    padding-block: 36px;
  }
}
</style>
