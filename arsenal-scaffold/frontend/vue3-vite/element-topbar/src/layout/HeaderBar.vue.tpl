<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import http from '@/api/http';

/**
 * 顶栏用户区：当前用户 + 修改密码 + 退出登录。
 * 修改密码调的是「给自己改密」的接口；管理员给他人重置密码在用户管理页。
 */
const router = useRouter();
const auth = useAuthStore();

const dialogVisible = ref(false);
const newPassword = ref('');
const confirm2 = ref('');
const submitting = ref(false);

async function changePassword() {
  if (!newPassword.value) {
    ElMessage.warning('请填写新密码');
    return;
  }
  if (newPassword.value !== confirm2.value) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  submitting.value = true;
  try {
    // 自助改密走管理员重置端点（v1 契约未提供带原密码校验的独立端点，
    // 权限码由后端按角色校验）；改完强制重新登录让旧会话失效
    await http.put(`/users/${auth.user?.id}/password`, { password: newPassword.value });
    ElMessage.success('修改成功，请重新登录');
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
</script>

<template>
  <div class="bar">
    <el-dropdown>
      <span class="user">
        <el-icon class="icon"><UserFilled /></el-icon>
        {{ auth.user?.nickname || auth.user?.username || '未登录' }}
      </span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item @click="dialogVisible = true">修改密码</el-dropdown-item>
          <el-dropdown-item divided @click="doLogout">退出登录</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dialog v-model="dialogVisible" title="修改密码" width="420px">
      <el-form label-width="90px">
        <el-form-item label="新密码">
          <el-input v-model="newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="confirm2" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="changePassword">确定</el-button>
      </template>
    </el-dialog>
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
  /* 顶栏导航式布局里本组件坐在深色 header 上（#001529），
     不显式给色会继承 body 的深字 —— 深底深字等于看不见 */
  color: #e8f0ec;
}
.icon {
  margin-right: 2px;
}
</style>
