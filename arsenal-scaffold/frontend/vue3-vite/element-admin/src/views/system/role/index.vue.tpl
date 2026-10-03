<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  assignRolePermissions,
  createRole,
  deleteRole,
  pageRoles,
  permissionTree,
  rolePermissionIds,
  updateRole,
} from '@/api/role';
import type { PermissionNode, Role } from '@/types/api';

/**
 * 角色管理：CRUD + 权限树勾选。
 * 权限树里分组节点 = 菜单，叶子 = 按钮权限；el-tree 的勾选会连带父节点
 * 半选态，提交时只取叶子 id（后端按叶子归并出该角色的权限码集合）。
 */
const loading = ref(false);
const rows = ref<Role[]>([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 10, keyword: '' });

async function load() {
  loading.value = true;
  try {
    const res = await pageRoles(query);
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
const form = reactive({ name: '', code: '', description: '' });
const rules: FormRules = {
  name: [{ required: true, message: '请输入角色名', trigger: 'blur' }],
  code: [
    { required: true, message: '请输入角色编码', trigger: 'blur' },
    { pattern: /^[A-Z0-9_]{2,32}$/, message: '大写字母/数字/下划线', trigger: 'blur' },
  ],
};

function openCreate() {
  editingId.value = null;
  Object.assign(form, { name: '', code: '', description: '' });
  dialogVisible.value = true;
}
function openEdit(row: Role) {
  editingId.value = row.id;
  Object.assign(form, { name: row.name, code: row.code, description: row.description });
  dialogVisible.value = true;
}
async function submit() {
  const ok = await formRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  if (editingId.value === null) {
    await createRole({ ...form });
    ElMessage.success('已创建');
  } else {
    await updateRole(editingId.value, { ...form });
    ElMessage.success('已保存');
  }
  dialogVisible.value = false;
  load();
}
async function remove(row: Role) {
  await ElMessageBox.confirm(`确认删除角色「${row.name}」？`, '删除确认', { type: 'warning' });
  await deleteRole(row.id);
  ElMessage.success('已删除');
  load();
}

// ── 权限树 ─────────────────────────────────────────────────
const permDialog = ref(false);
const permTarget = ref<Role | null>(null);
const treeRef = ref<InstanceType<typeof import('element-plus')['ElTree']>>();
const treeData = ref<PermissionNode[]>([]);
const saving = ref(false);

async function openPerms(row: Role) {
  permTarget.value = row;
  permDialog.value = true;
  if (treeData.value.length === 0) {
    treeData.value = await permissionTree();
  }
  const checked = await rolePermissionIds(row.id);
  // 只勾叶子：分组节点由 el-tree 的父子联动自己推，避免把分组 id 混进提交值
  treeRef.value?.setCheckedKeys(checked);
}
async function savePerms() {
  if (!permTarget.value) return;
  const checked = treeRef.value?.getCheckedKeys(true) as number[];
  saving.value = true;
  try {
    await assignRolePermissions(permTarget.value.id, checked);
    ElMessage.success('已保存');
    permDialog.value = false;
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <el-card>
    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="角色名 / 编码"
        clearable
        class="search"
        @keyup.enter="search"
      />
      <el-button type="primary" @click="search">搜索</el-button>
      <div class="spacer" />
      <el-button v-perm="'sys:role:save'" type="primary" plain @click="openCreate">新增角色</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column prop="name" label="角色名" min-width="140" />
      <el-table-column prop="code" label="编码" min-width="140" />
      <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'">
            {{ row.status === 1 ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button v-perm="'sys:role:update'" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-perm="'sys:role:assignPerm'" link type="primary" @click="openPerms(row)">分配权限</el-button>
          <el-button v-perm="'sys:role:delete'" link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="pager"
      layout="total, prev, pager, next"
      :total="total"
      :current-page="query.page"
      :page-size="query.pageSize"
      @current-change="(p: number) => { query.page = p; load(); }"
    />
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增角色' : '编辑角色'" width="460px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
      <el-form-item label="角色名" prop="name">
        <el-input v-model="form.name" />
      </el-form-item>
      <el-form-item label="编码" prop="code">
        <el-input v-model="form.code" placeholder="如 OPERATOR" />
      </el-form-item>
      <el-form-item label="描述" prop="description">
        <el-input v-model="form.description" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submit">确定</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="permDialog" :title="`分配权限 · ${permTarget?.name ?? ''}`" width="480px">
    <el-tree
      ref="treeRef"
      :data="treeData"
      node-key="id"
      show-checkbox
      default-expand-all
      :props="{ label: 'label', children: 'children' }"
    />
    <template #footer>
      <el-button @click="permDialog = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="savePerms">保存</el-button>
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
