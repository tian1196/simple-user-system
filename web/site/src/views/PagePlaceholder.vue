<script setup lang="ts">
import { useRoute } from 'vue-router'
import PageHeading from '../components/PageHeading.vue'
const route = useRoute()
</script>
<template>
  <section class="site-container page-container">
    <PageHeading :title="String(route.meta.title || '设备台账')" />
    <div class="page-placeholder"><p>页面内容待开发</p></div>
  </section>
</template>
