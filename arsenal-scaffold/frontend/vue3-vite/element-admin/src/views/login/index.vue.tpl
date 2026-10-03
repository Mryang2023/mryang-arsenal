<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

/**
 * 登录页。登录成功后优先跳 redirect（守卫在拦截时记下了原目标），
 * 没有则回首页。表单校验只做「非空 + 长度」，用户名是否存在属于后端的事。
 */
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const formRef = ref<FormInstance>();
const form = reactive({ username: '', password: '' });
const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
};
const submitting = ref(false);

async function submit() {
  await formRef.value?.validate().catch(() => Promise.reject(new Error('校验未通过')));
  submitting.value = true;
  try {
    await auth.login(form.username, form.password);
    ElMessage.success('登录成功');
    const redirect = route.query.redirect;
    router.push(typeof redirect === 'string' && redirect ? redirect : '/');
  } catch {
    // 错误提示由 http 拦截器统一弹出（用户不存在/密码错不区分，防止账号枚举）
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="wrap">
    <el-card class="card">
      <h2 class="title">登录 · {{ '管理端' }}</h2>
      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="submit">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名" :prefix-icon="'User'" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="密码" :prefix-icon="'Lock'" />
        </el-form-item>
        <el-button class="btn" type="primary" size="large" :loading="submitting" @click="submit">
          登 录
        </el-button>
      </el-form>
      <p class="hint">初始账号 admin / admin123，首次登录后请修改</p>
    </el-card>
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
