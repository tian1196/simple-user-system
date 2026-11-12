<script setup lang="ts">
import PageState from '../components/PageState.vue'
import SiteButton from '../components/SiteButton.vue'
</script>
<template>
  <div class="site-container page-container">
    <PageState kind="empty" title="页面不存在" description="这个地址可能已变更，请返回首页。"><SiteButton to="/">返回首页</SiteButton></PageState>
  </div>
</template>
