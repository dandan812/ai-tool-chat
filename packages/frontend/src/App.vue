<script setup lang="ts">
import { RouterView } from 'vue-router'
import { ElConfigProvider } from 'element-plus/es/components/config-provider/index'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import AccountGate from './components/AccountGate.vue'
</script>
<template>
  <ElConfigProvider size="small" :locale="zhCn">
    <AccountGate><RouterView /></AccountGate>
  </ElConfigProvider>
</template>
