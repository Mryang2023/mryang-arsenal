<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { NButton, NSwitch, type DataTableColumns, type FormInst, type FormRules } from 'naive-ui';
import { dialog, message } from '@/api/feedback';
import { useAuthStore } from '@/stores/auth';
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
 * Naive UI 的 n-data-table 吃 columns 数组：单元格内要交互（开关/按钮组），
 * 用 render 函数 + h() 写，模板里只保留弹窗表单。
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
const formRef = ref<FormInst>();
const form = reactive({ username: '', nickname: '', email: '', phone: '', password: '' });
const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: ['blur', 'input'] },
    {
      validator: (_rule, value: string) => /^[a-zA-Z0-9_]{3,32}$/.test(value ?? ''),
      message: '3-32 位字母数字下划线',
      trigger: ['blur', 'input'],
    },
  ],
  nickname: { required: true, message: '请输入昵称', trigger: ['blur', 'input'] },
  password: {
    validator: (_rule, value: string) => !value || value.length >= 6,
    message: '初始密码至少 6 位',
    trigger: ['blur', 'input'],
  },
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
  formRef.value
    ?.validate()
    .then(async () => {
      if (editingId.value === null) {
        await createUser({ ...form });
        message.success('已创建');
      } else {
        await updateUser(editingId.value, {
          nickname: form.nickname,
          email: form.email,
          phone: form.phone,
        });
        message.success('已保存');
      }
      dialogVisible.value = false;
      load();
    })
    .catch(() => {
      // 校验未通过：naive 已在字段旁标红，这里静默返回
    });
}

// ── 启停用 / 删除 / 重置密码 ────────────────────────────────
async function toggleStatus(row: SysUser) {
  await updateUser(row.id, {
    nickname: row.nickname,
    email: row.email,
    phone: row.phone,
    status: row.status === 1 ? 0 : 1,
  });
  message.success(row.status === 1 ? '已停用' : '已启用');
  load();
}
async function remove(row: SysUser) {
  dialog.warning({
    title: '删除确认',
    content: `确认删除用户「${row.username}」？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await deleteUser(row.id);
      message.success('已删除');
      load();
    },
  });
}

// 重置密码：离散 API 没有 prompt 形态，用一个小弹窗自己接输入
const resetVisible = ref(false);
const resetTarget = ref<SysUser | null>(null);
const resetPwd = ref('');
const resetSubmitting = ref(false);

function openReset(row: SysUser) {
  resetTarget.value = row;
  resetPwd.value = '';
  resetVisible.value = true;
}
async function submitReset() {
  if (resetPwd.value.length < 6) {
    message.warning('至少 6 位');
    return;
  }
  resetSubmitting.value = true;
  try {
    await resetPassword(resetTarget.value!.id, resetPwd.value);
    message.success('已重置');
    resetVisible.value = false;
  } finally {
    resetSubmitting.value = false;
  }
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
  message.success('已分配');
  roleDialog.value = false;
}

// ── 表格列（render 用 h()，模板里不再写列定义）──────────────
// 操作列的权限显隐：v-perm 指令对 render 函数不生效 —— 这里手动比对
// 权限码集合，语义与指令一致（无权限的按钮根本不出现）
const auth = useAuthStore();
const columns: DataTableColumns<SysUser> = [
  { title: '用户名', key: 'username', minWidth: 120 },
  { title: '昵称', key: 'nickname', minWidth: 120 },
  { title: '邮箱', key: 'email', minWidth: 160 },
  { title: '手机号', key: 'phone', minWidth: 130 },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row) {
      return h(NSwitch, {
        value: row.status === 1,
        size: 'small',
        onUpdateValue: () => toggleStatus(row),
      });
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 250,
    render(row) {
      return h('div', { class: 'row-actions' }, [
        h(
          NButton,
          {
            quaternary: true,
            type: 'primary',
            size: 'tiny',
            // v-perm 指令对 render 函数不生效 —— 这里手动比对权限码集合，
            // 语义与指令一致（无权限的按钮根本不出现）
            style: auth.perms.has('sys:user:update') ? '' : 'display:none',
            onClick: () => openEdit(row),
          },
          { default: () => '编辑' },
        ),
        h(
          NButton,
          {
            quaternary: true,
            type: 'primary',
            size: 'tiny',
            style: auth.perms.has('sys:user:assignRole') ? '' : 'display:none',
            onClick: () => openRoles(row),
          },
          { default: () => '分配角色' },
        ),
        h(
          NButton,
          {
            quaternary: true,
            type: 'warning',
            size: 'tiny',
            style: auth.perms.has('sys:user:resetPwd') ? '' : 'display:none',
            onClick: () => openReset(row),
          },
          { default: () => '重置密码' },
        ),
        h(
          NButton,
          {
            quaternary: true,
            type: 'error',
            size: 'tiny',
            style: auth.perms.has('sys:user:delete') ? '' : 'display:none',
            onClick: () => remove(row),
          },
          { default: () => '删除' },
        ),
      ]);
    },
  },
];

onMounted(load);</script>

<template>
  <n-card>
    <div class="toolbar">
      <n-input
        v-model:value="query.keyword"
        placeholder="用户名 / 昵称"
        clearable
        class="search"
        @keyup.enter="search"
      />
      <n-button type="primary" @click="search">搜索</n-button>
      <div class="spacer" />
      <n-button v-perm="'sys:user:save'" type="primary" secondary @click="openCreate">
        新增用户
      </n-button>
    </div>

    <n-data-table
      remote
      :columns="columns"
      :data="rows"
      :loading="loading"
      :row-key="(r: SysUser) => r.id"
      :pagination="{
        page: query.page,
        pageSize: query.pageSize,
        itemCount: total,
        pageSizes: [10, 20, 50],
        showSizePicker: true,
        onChange: (p: number) => { query.page = p; load(); },
        onUpdatePageSize: (s: number) => { query.pageSize = s; query.page = 1; load(); },
      }"
    />
  </n-card>

  <n-modal
    v-model:show="dialogVisible"
    preset="card"
    :title="editingId === null ? '新增用户' : '编辑用户'"
    class="form-card"
    :bordered="false"
  >
    <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="80">
      <n-form-item label="用户名" path="username">
        <n-input v-model:value="form.username" :disabled="editingId !== null" />
      </n-form-item>
      <n-form-item label="昵称" path="nickname">
        <n-input v-model:value="form.nickname" />
      </n-form-item>
      <n-form-item label="邮箱" path="email">
        <n-input v-model:value="form.email" />
      </n-form-item>
      <n-form-item label="手机号" path="phone">
        <n-input v-model:value="form.phone" />
      </n-form-item>
      <n-form-item v-if="editingId === null" label="初始密码" path="password">
        <n-input v-model:value="form.password" type="password" show-password-on="click" placeholder="至少 6 位" />
      </n-form-item>
    </n-form>
    <template #footer>
      <div class="form-actions">
        <n-button @click="dialogVisible = false">取消</n-button>
        <n-button type="primary" @click="submit">确定</n-button>
      </div>
    </template>
  </n-modal>

  <n-modal
    v-model:show="roleDialog"
    preset="card"
    :title="`分配角色 · ${roleTarget?.username ?? ''}`"
    class="form-card"
    :bordered="false"
  >
    <n-select v-model:value="roleSelection" multiple placeholder="选择角色" :options="roleOptions.map((r) => ({ label: r.name, value: r.id }))" />
    <template #footer>
      <div class="form-actions">
        <n-button @click="roleDialog = false">取消</n-button>
        <n-button type="primary" @click="submitRoles">确定</n-button>
      </div>
    </template>
  </n-modal>

  <n-modal
    v-model:show="resetVisible"
    preset="card"
    :title="`重置密码 · ${resetTarget?.username ?? ''}`"
    class="form-card"
    :bordered="false"
  >
    <n-input v-model:value="resetPwd" type="password" show-password-on="click" placeholder="至少 6 位" />
    <template #footer>
      <div class="form-actions">
        <n-button @click="resetVisible = false">取消</n-button>
        <n-button type="primary" :loading="resetSubmitting" @click="submitReset">确定</n-button>
      </div>
    </template>
  </n-modal>
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
.form-card {
  width: 480px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
:deep(.row-actions) {
  display: flex;
  gap: 2px;
}
</style>
