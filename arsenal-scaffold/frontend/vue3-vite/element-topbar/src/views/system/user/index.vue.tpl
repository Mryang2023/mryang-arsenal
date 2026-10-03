<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  assignRoles,
  createUser,
  deleteUser,
  pageUsers,
  resetPassword,
  updateUser,
} from '@/api/user';
import { pageRoles } from '@/api/role';
import type { Role, SysUser } from '@/types/api';

/**
 * 用户管理：搜索 + 分页表格 + 新增/编辑弹窗 + 启停用 + 重置密码 + 分配角色。
 * 列表页是全项目的样板页 —— 新业务页面照这里的结构抄。
 */
const loading = ref(false);
const rows = ref<SysUser[]>([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 10, keyword: '' });

async function load() {
  loading.value = true;
  try {
    const res = await pageUsers(query);
    rows.value = res.list;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}
function search() {
  query.page = 1;
  load();
}

// ── 新增 / 编辑 ─────────────────────────────────────────────
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();
const form = reactive({ username: '', nickname: '', email: '', phone: '', password: '' });
const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]{3,32}$/, message: '3-32 位字母数字下划线', trigger: 'blur' },
  ],
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  password: [{ required: true, min: 6, message: '初始密码至少 6 位', trigger: 'blur' }],
};

function openCreate() {
  editingId.value = null;
  Object.assign(form, { username: '', nickname: '', email: '', phone: '', password: '' });
  dialogVisible.value = true;
}
function openEdit(row: SysUser) {
  editingId.value = row.id;
  Object.assign(form, {
    username: row.username,
    nickname: row.nickname,
    email: row.email,
    phone: row.phone,
    password: '',
  });
  dialogVisible.value = true;
}
async function submit() {
  // validate 通过才继续；拒绝时 Element Plus 已在字段旁标红，这里静默返回即可
  const ok = await formRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  if (editingId.value === null) {
    await createUser({ ...form });
    ElMessage.success('已创建');
  } else {
    await updateUser(editingId.value, {
      nickname: form.nickname,
      email: form.email,
      phone: form.phone,
    });
    ElMessage.success('已保存');
  }
  dialogVisible.value = false;
  load();
}

// ── 启停用 / 删除 / 重置密码 ────────────────────────────────
async function toggleStatus(row: SysUser) {
  await updateUser(row.id, {
    nickname: row.nickname,
    email: row.email,
    phone: row.phone,
    status: row.status === 1 ? 0 : 1,
  });
  ElMessage.success(row.status === 1 ? '已停用' : '已启用');
  load();
}
async function remove(row: SysUser) {
  await ElMessageBox.confirm(`确认删除用户「${row.username}」？`, '删除确认', { type: 'warning' });
  await deleteUser(row.id);
  ElMessage.success('已删除');
  load();
}
async function doResetPassword(row: SysUser) {
  const { value } = await ElMessageBox.prompt(`为「${row.username}」设置新密码`, '重置密码', {
    inputPattern: /^.{6,}$/,
    inputErrorMessage: '至少 6 位',
  });
  await resetPassword(row.id, value);
  ElMessage.success('已重置');
}

// ── 分配角色 ────────────────────────────────────────────────
const roleDialog = ref(false);
const roleTarget = ref<SysUser | null>(null);
const roleSelection = ref<number[]>([]);
const roleOptions = ref<Role[]>([]);

async function openRoles(row: SysUser) {
  roleTarget.value = row;
  // 后端 v1 契约没有「查用户已有角色」的读端点，这里无法回显勾选，
  // 提交的是全量覆盖；要回显就在后端补一个 GET /users/{id}/roles
  roleSelection.value = [];
  if (roleOptions.value.length === 0) {
    const res = await pageRoles({ page: 1, pageSize: 500 });
    roleOptions.value = res.list;
  }
  roleDialog.value = true;
}
async function submitRoles() {
  if (!roleTarget.value) return;
  await assignRoles(roleTarget.value.id, roleSelection.value);
  ElMessage.success('已分配');
  roleDialog.value = false;
}

onMounted(load);
</script>

<template>
  <el-card>
    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="用户名 / 昵称"
        clearable
        class="search"
        @keyup.enter="search"
      />
      <el-button type="primary" @click="search">搜索</el-button>
      <div class="spacer" />
      <el-button v-perm="'sys:user:save'" type="primary" plain @click="openCreate">新增用户</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column prop="username" label="用户名" min-width="120" />
      <el-table-column prop="nickname" label="昵称" min-width="120" />
      <el-table-column prop="email" label="邮箱" min-width="160" />
      <el-table-column prop="phone" label="手机号" min-width="130" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 1"
            @change="toggleStatus(row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <el-button v-perm="'sys:user:update'" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-perm="'sys:user:assignRole'" link type="primary" @click="openRoles(row)">分配角色</el-button>
          <el-button v-perm="'sys:user:resetPwd'" link type="warning" @click="doResetPassword(row)">重置密码</el-button>
          <el-button v-perm="'sys:user:delete'" link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="pager"
      layout="total, prev, pager, next, sizes"
      :total="total"
      :current-page="query.page"
      :page-size="query.pageSize"
      :page-sizes="[10, 20, 50]"
      @current-change="(p: number) => { query.page = p; load(); }"
      @size-change="(s: number) => { query.pageSize = s; query.page = 1; load(); }"
    />
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增用户' : '编辑用户'" width="480px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
      <el-form-item label="用户名" prop="username">
        <el-input v-model="form.username" :disabled="editingId !== null" />
      </el-form-item>
      <el-form-item label="昵称" prop="nickname">
        <el-input v-model="form.nickname" />
      </el-form-item>
      <el-form-item label="邮箱" prop="email">
        <el-input v-model="form.email" />
      </el-form-item>
      <el-form-item label="手机号" prop="phone">
        <el-input v-model="form.phone" />
      </el-form-item>
      <el-form-item v-if="editingId === null" label="初始密码" prop="password">
        <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submit">确定</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="roleDialog" :title="`分配角色 · ${roleTarget?.username ?? ''}`" width="420px">
    <el-select v-model="roleSelection" multiple style="width: 100%" placeholder="选择角色">
      <el-option v-for="r in roleOptions" :key="r.id" :label="r.name" :value="r.id" />
    </el-select>
    <template #footer>
      <el-button @click="roleDialog = false">取消</el-button>
      <el-button type="primary" @click="submitRoles">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.search {
  width: 240px;
}
.spacer {
  flex: 1;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
</style>
