<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { dialog } from '@/api/feedback';
import { useAuthStore } from '@/stores/auth';
import http from '@/api/http';

/**
 * 顶栏用户区：当前用户 + 修改密码 + 退出登录。
 * 修改密码调的是「给自己改密」的接口；管理员给他人重置密码在用户管理页。
 */
const router = useRouter();
const auth = useAuthStore();
const dialog = useDialog();

const dialogVisible = ref(false);
const newPassword = ref('');
const confirm2 = ref('');
const submitting = ref(false);

async function changePassword() {
  if (!newPassword.value) {
    dialog.warning({ title: '提示', content: '请填写新密码', positiveText: '知道了' });
    return;
  }
  if (newPassword.value !== confirm2.value) {
    dialog.warning({ title: '提示', content: '两次输入的新密码不一致', positiveText: '知道了' });
    return;
  }
  submitting.value = true;
  try {
    // 自助改密走管理员重置端点（v1 契约未提供带原密码校验的独立端点，
    // 权限码由后端按角色校验）；改完强制重新登录让旧会话失效
    await http.put(`/users/${auth.user?.id}/password`, { password: newPassword.value });
    dialog.success({ title: '修改成功', content: '请重新登录', positiveText: '知道了' });
    dialogVisible.value = false;
    await doLogout();
  } finally {
    submitting.value = false;
  }
}

async function doLogout() {
  await auth.logout();
  router.push('/login');
}

const options = [
  { label: '修改密码', key: 'password' },
  { label: '退出登录', key: 'logout' },
];

function onAction(key: string) {
  if (key === 'password') dialogVisible.value = true;
  if (key === 'logout') void doLogout();
}
</script>

<template>
  <div class="bar">
    <n-dropdown trigger="click" :options="options" @select="onAction">
      <span class="user">
        <span class="avatar">{{ (auth.user?.nickname || auth.user?.username || '未')[0] }}</span>
        {{ auth.user?.nickname || auth.user?.username || '未登录' }}
      </span>
    </n-dropdown>

    <n-modal
      v-model:show="dialogVisible"
      preset="card"
      title="修改密码"
      class="pwd-card"
      :bordered="false"
      :mask-closable="false"
    >
      <n-form label-placement="left" label-width="90">
        <n-form-item label="新密码">
          <n-input v-model:value="newPassword" type="password" show-password-on="click" />
        </n-form-item>
        <n-form-item label="确认新密码">
          <n-input v-model:value="confirm2" type="password" show-password-on="click" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="pwd-actions">
          <NButton @click="dialogVisible = false">取消</NButton>
          <NButton type="primary" :loading="submitting" @click="changePassword">确定</NButton>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
}
.user {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  outline: none;
}
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #16385f;
  color: #fff;
  font-size: 12px;
}
.pwd-card {
  width: 420px;
}
.pwd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
