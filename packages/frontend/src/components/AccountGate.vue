<script setup lang="ts">
import { useAccountSession } from '../features/accounts/useAccountSession'
import { MessageSquare, ArrowRight, LoaderCircle, RefreshCw } from '@lucide/vue'
import { ElAlert } from 'element-plus/es/components/alert/index'
import { ElButton } from 'element-plus/es/components/button/index'
import { ElForm, ElFormItem } from 'element-plus/es/components/form/index'
import { ElInput } from 'element-plus/es/components/input/index'
import 'element-plus/es/components/alert/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/form/style/css'
import 'element-plus/es/components/form-item/style/css'
import 'element-plus/es/components/input/style/css'
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
  loadFailed,
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
  <main v-else class="account-gate" :aria-busy="!ready || pending">
    <header class="account-brand">
      <MessageSquare aria-hidden="true" />
      <span>AI Tool Chat</span>
    </header>
    <section class="account-form" aria-labelledby="account-title">
      <h1 id="account-title">
        {{
          !ready
            ? '正在连接…'
            : loadFailed || guestEnabled
              ? '暂时无法连接'
              : registering
                ? '创建账户'
                : '登录'
        }}
      </h1>
      <template v-if="ready && (loadFailed || guestEnabled)">
        <ElAlert
          v-if="error"
          class="account-error"
          :title="error"
          type="error"
          :closable="false"
          show-icon
        />
        <ElButton type="primary" class="account-submit" native-type="button" @click="retry">
          <RefreshCw aria-hidden="true" />
          <span>重试</span>
        </ElButton>
      </template>
      <ElForm
        v-else-if="ready"
        class="account-fields"
        label-position="top"
        @submit.prevent="submit"
      >
        <ElFormItem label="用户名" for="username">
          <ElInput
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
        </ElFormItem>
        <ElFormItem label="密码" for="password">
          <ElInput
            id="password"
            v-model="password"
            type="password"
            :autocomplete="registering ? 'new-password' : 'current-password'"
            required
            :minlength="registering ? 12 : undefined"
            maxlength="128"
            :disabled="pending"
            :aria-describedby="registering ? 'account-password-hint' : undefined"
            show-password
          />
          <p v-if="registering" id="account-password-hint" class="account-hint">至少 12 个字符</p>
        </ElFormItem>
        <ElAlert
          v-if="error"
          class="account-error"
          :title="error"
          type="error"
          :closable="false"
          show-icon
        />
        <ElButton native-type="submit" type="primary" class="account-submit" :disabled="pending">
          <span>{{ pending ? '处理中…' : registering ? '注册账户' : '登录工作台' }}</span>
          <LoaderCircle v-if="pending" class="account-spinner" aria-hidden="true" />
          <ArrowRight v-else aria-hidden="true" />
        </ElButton>
        <ElButton
          v-if="registrationEnabled"
          text
          class="account-switch"
          native-type="button"
          :disabled="pending"
          @click="toggleRegistration"
        >
          {{ registering ? '已有账户，去登录' : '创建新账户' }}
        </ElButton>
        <p v-else class="account-hint account-registration-note">
          当前不开放注册，请联系管理员开通。
        </p>
      </ElForm>
      <div v-else class="account-loading" role="status" aria-label="正在连接账户">
        <LoaderCircle class="account-spinner" aria-hidden="true" />
      </div>
    </section>
  </main>
</template>

<style scoped>
.account-gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  min-height: 100dvh;
  padding: var(--space-8) var(--space-6);
  overflow: auto;
  color: var(--text-primary);
  background: var(--bg-primary);
  font-size: var(--text-sm);
  letter-spacing: 0;
}
.account-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: var(--control-height);
  max-width: 100%;
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 1.5;
}
.account-brand svg {
  flex-shrink: 0;
  width: var(--icon-size-lg);
  height: var(--icon-size-lg);
  color: var(--text-primary);
}
.account-form {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  box-sizing: border-box;
  width: min(100%, var(--layout-account-width));
  min-width: 0;
  margin: 0 auto;
  padding: var(--space-8) 0;
}
.account-form h1 {
  margin: 0 0 var(--space-8);
  color: var(--text-primary);
  font-size: var(--text-2xl);
  font-weight: 600;
  line-height: 1.4;
  text-align: center;
  overflow-wrap: anywhere;
}
.account-fields {
  display: grid;
  gap: var(--space-5);
  min-width: 0;
}
.account-fields :deep(.el-form-item) {
  min-width: 0;
  margin: 0;
}
.account-fields :deep(.el-form-item__label) {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.account-fields :deep(.el-form-item__content) {
  min-width: 0;
  line-height: 1.5;
}
.account-fields :deep(.el-input) {
  min-width: 0;
  --el-input-height: calc(var(--control-height) + var(--space-3));
}
.account-fields :deep(.el-input__wrapper) {
  min-height: calc(var(--control-height) + var(--space-3));
  padding: 0 var(--space-3);
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: 0 0 0 var(--border-width) var(--border-default) inset;
}
.account-fields :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 var(--border-width) var(--border-strong) inset;
}
.account-fields :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 var(--focus-width) var(--accent-primary) inset;
}
.account-fields :deep(.el-input.is-disabled .el-input__wrapper) {
  background: var(--bg-secondary);
  box-shadow: 0 0 0 var(--border-width) var(--border-subtle) inset;
}
.account-fields :deep(.el-input__inner) {
  height: calc(var(--control-height) + var(--space-3));
  font-size: var(--text-lg);
}
.account-hint {
  width: 100%;
  margin: var(--space-2) 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.account-registration-note {
  margin: 0;
  text-align: center;
}
.account-submit.el-button {
  width: 100%;
  min-height: calc(var(--control-height) + var(--space-3));
  height: auto;
  padding: var(--space-3) var(--space-4);
  margin: var(--space-5) 0 0;
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  font-weight: 500;
  --el-button-text-color: var(--on-accent);
  --el-button-bg-color: var(--accent-primary);
  --el-button-border-color: var(--accent-primary);
  --el-button-hover-text-color: var(--on-accent);
  --el-button-hover-bg-color: var(--accent-primary-hover);
  --el-button-hover-border-color: var(--accent-primary-hover);
  --el-button-active-text-color: var(--on-accent);
  --el-button-active-bg-color: var(--accent-primary);
  --el-button-active-border-color: var(--accent-primary);
  --el-button-disabled-text-color: var(--text-disabled);
  --el-button-disabled-bg-color: var(--bg-tertiary);
  --el-button-disabled-border-color: var(--border-subtle);
}
.account-submit.el-button:not(:disabled) {
  color: var(--on-accent);
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}
.account-submit.el-button:not(:disabled):hover {
  color: var(--on-accent);
  background: var(--accent-primary-hover);
  border-color: var(--accent-primary-hover);
}
.account-fields .account-submit {
  margin: 0;
}
.account-submit :deep(span),
.account-switch :deep(span) {
  max-width: 100%;
  gap: var(--space-2);
  line-height: 1.5;
  white-space: normal;
  overflow-wrap: anywhere;
}
.account-submit svg {
  flex-shrink: 0;
  width: var(--icon-size);
  height: var(--icon-size);
}
.account-switch.el-button {
  justify-self: center;
  max-width: 100%;
  min-height: var(--control-height);
  height: auto;
  margin: 0;
  padding: var(--space-2);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}
.account-switch.el-button:not(:disabled):hover {
  color: var(--text-primary);
  background: var(--bg-secondary);
}
.account-switch.el-button:disabled {
  color: var(--text-disabled);
}
.account-error {
  box-sizing: border-box;
  min-width: 0;
  border-radius: var(--radius-md);
}
.account-error :deep(.el-alert__content) {
  min-width: 0;
}
.account-error :deep(.el-alert__title) {
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.account-loading {
  display: flex;
  justify-content: center;
  width: 100%;
  height: auto;
  color: var(--text-tertiary);
}
.account-loading svg {
  width: var(--icon-size-lg);
  height: var(--icon-size-lg);
}
.account-spinner {
  animation: account-spin 1s linear infinite;
}
:deep(.el-button:focus-visible) {
  outline: var(--focus-width) solid var(--accent-primary);
  outline-offset: var(--space-1);
}
@keyframes account-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .account-spinner {
    animation: none;
  }
}
@media (max-width: 480px) {
  .account-gate {
    padding: var(--space-6) var(--space-4);
  }
}
</style>
