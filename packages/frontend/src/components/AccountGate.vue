<script setup lang="ts">
import { useAccountSession } from '../features/accounts/useAccountSession'
import { MessageSquare, ArrowRight, LoaderCircle, RefreshCw } from '@lucide/vue'
const {
  ready,
  user,
  username,
  password,
  registering,
  registrationEnabled,
  guestEnabled,
  pending,
  error,
  submit,
  retry
} = useAccountSession()
function toggleRegistration() {
  registering.value = !registering.value
  error.value = ''
}
</script>
<template>
  <slot v-if="ready && user" />
  <main v-else class="account-gate">
    <div class="account-brand"><MessageSquare /><span>i-tool chat</span></div>
    <section class="account-form">
      <h1>{{ !ready ? '正在连接…' : guestEnabled ? '暂时无法连接' : registering ? '创建账户' : '登录' }}</h1>
      <template v-if="ready && guestEnabled">
        <p v-if="error" role="alert" class="status-banner is-error">{{ error }}</p>
        <button class="button primary" @click="retry"><RefreshCw />重试</button>
      </template>
      <form v-else-if="ready" @submit.prevent="submit">
        <label for="username">用户名</label
        ><input
          id="username"
          v-model="username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          minlength="3"
          maxlength="64"
          :disabled="pending"
        />
        <label for="password">密码</label
        ><input
          id="password"
          v-model="password"
          type="password"
          :autocomplete="registering ? 'new-password' : 'current-password'"
          required
          :minlength="registering ? 12 : undefined"
          maxlength="128"
          :disabled="pending"
        />
        <small v-if="registering">至少 12 个字符</small>
        <p v-if="error" role="alert" class="status-banner is-error">{{ error }}</p>
        <button type="submit" class="button primary account-submit" :disabled="pending">
          <LoaderCircle v-if="pending" class="spin" /><ArrowRight v-else />{{
            pending ? '处理中…' : registering ? '注册账户' : '登录工作台'
          }}
        </button>
        <button
          v-if="registrationEnabled"
          type="button"
          class="account-switch"
          :disabled="pending"
          @click="toggleRegistration"
        >
          {{ registering ? '已有账户，去登录' : '创建新账户' }}
        </button>
        <small v-else>当前不开放注册，请联系管理员开通。</small>
      </form>
      <LoaderCircle v-else class="spin account-loading" />
    </section>
  </main>
</template>
