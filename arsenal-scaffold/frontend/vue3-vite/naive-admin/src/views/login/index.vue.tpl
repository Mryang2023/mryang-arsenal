<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { type FormInst, type FormRules } from 'naive-ui';
import { message as feedback } from '@/api/feedback';
import { useAuthStore } from '@/stores/auth';

/**
 * 登录页。登录成功后优先跳 redirect（守卫在拦截时记下了原目标），
 * 没有则回首页。表单校验只做「非空 + 长度」，用户名是否存在属于后端的事。
 */
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const formRef = ref<FormInst>();
const form = reactive({ username: '', password: '' });
const rules: FormRules = {
  username: { required: true, message: '请输入用户名', trigger: 'blur' },
  password: [
    { required: true, message: '请输入密码', trigger: ['blur', 'input'] },
    { min: 6, message: '密码至少 6 位', trigger: ['blur', 'input'] },
  ],
};
const submitting = ref(false);

async function submit() {
  formRef.value
    ?.validate()
    .then(async () => {
      submitting.value = true;
      try {
        await auth.login(form.username, form.password);
        feedback.success('登录成功');
        const redirect = route.query.redirect;
        router.push(typeof redirect === 'string' && redirect ? redirect : '/');
      } catch {
        // 错误提示由 http 拦截器统一弹出（用户不存在/密码错不区分，防止账号枚举）
      } finally {
        submitting.value = false;
      }
    })
    .catch(() => {
      // 校验未通过：naive 已在字段旁标红，这里静默返回
    });
}
</script>

<template>
  <div class="wrap">
    <n-card class="card" :bordered="false">
      <h2 class="title">登录 · {{ '管理端' }}</h2>
      <n-form
        ref="formRef"
        :model="form"
        :rules="rules"
        size="large"
        :show-label="false"
        @keyup.enter="submit"
      >
        <n-form-item path="username">
          <n-input v-model:value="form.username" placeholder="用户名" />
        </n-form-item>
        <n-form-item path="password">
          <n-input
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            placeholder="密码"
          />
        </n-form-item>
        <n-button class="btn" type="primary" size="large" :loading="submitting" @click="submit">
          登 录
        </n-button>
      </n-form>
      <p class="hint">初始账号 admin / admin123，首次登录后请修改</p>
    </n-card>
  </div>
</template>

<style scoped>
.wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0f2540 0%, #16385f 100%);
}
.card {
  width: 380px;
  padding: 12px 8px;
}
.title {
  text-align: center;
  margin: 4px 0 22px;
  color: #303133;
}
.btn {
  width: 100%;
}
.hint {
  margin-top: 14px;
  font-size: 12px;
  color: #909399;
  text-align: center;
}
</style>
