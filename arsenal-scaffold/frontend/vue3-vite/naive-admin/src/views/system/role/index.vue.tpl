<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { NButton, NTag, type DataTableColumns, type FormInst, type FormRules, type TreeOption } from 'naive-ui';
import { dialog, message } from '@/api/feedback';
import {
  assignRolePermissions,
  createRole,
  deleteRole,
  pageRoles,
  permissionTree,
  rolePermissionIds,
  updateRole,
} from '@/api/role';
import { useAuthStore } from '@/stores/auth';
import type { PermissionNode, Role } from '@/types/api';

/**
 * 角色管理：CRUD + 权限树勾选。
 * 权限树里分组节点 = 菜单，叶子 = 按钮权限；n-tree 开 cascade 后勾父带子，
 * 提交时只取叶子 id（后端按叶子归并出该角色的权限码集合）——
 * 用 flatNodes 把 id 映回节点，过滤出「没有 children」的勾选项。
 */
const auth = useAuthStore();
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
const formRef = ref<FormInst>();
const form = reactive({ name: '', code: '', description: '' });
const rules: FormRules = {
  name: { required: true, message: '请输入角色名', trigger: ['blur', 'input'] },
  code: [
    { required: true, message: '请输入角色编码', trigger: ['blur', 'input'] },
    {
      validator: (_rule, value: string) => /^[A-Z0-9_]{2,32}$/.test(value ?? ''),
      message: '大写字母/数字/下划线',
      trigger: ['blur', 'input'],
    },
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
  formRef.value
    ?.validate()
    .then(async () => {
      if (editingId.value === null) {
        await createRole({ ...form });
        message.success('已创建');
      } else {
        await updateRole(editingId.value, { ...form });
        message.success('已保存');
      }
      dialogVisible.value = false;
      load();
    })
    .catch(() => {
      // 校验未通过：naive 已在字段旁标红，这里静默返回
    });
}
async function remove(row: Role) {
  dialog.warning({
    title: '删除确认',
    content: `确认删除角色「${row.name}」？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await deleteRole(row.id);
      message.success('已删除');
      load();
    },
  });
}

// ── 权限树 ─────────────────────────────────────────────────
const permDialog = ref(false);
const permTarget = ref<Role | null>(null);
const treeData = ref<TreeOption[]>([]);
/** id → 是否叶子（没有 children）。提交时从勾选集合里过滤出叶子 id */
const leafIds = ref<Set<number>>(new Set());
const checkedKeys = ref<number[]>([]);
const saving = ref(false);

function toTreeOption(n: PermissionNode): TreeOption {
  return {
    key: n.id,
    label: n.label,
    children: n.children?.length ? n.children.map(toTreeOption) : undefined,
  };
}
function collectLeaves(n: PermissionNode, into: Set<number>) {
  if (!n.children?.length) into.add(n.id);
  else n.children.forEach((c) => collectLeaves(c, into));
}

async function openPerms(row: Role) {
  permTarget.value = row;
  permDialog.value = true;
  if (treeData.value.length === 0) {
    const tree: PermissionNode[] = await permissionTree();
    treeData.value = tree.map(toTreeOption);
    const leaves = new Set<number>();
    tree.forEach((n) => collectLeaves(n, leaves));
    leafIds.value = leaves;
  }
  // 只勾叶子：分组节点由 n-tree 的 cascade 自己带出，提交前再过滤回叶子
  checkedKeys.value = await rolePermissionIds(row.id);
}
async function savePerms() {
  if (!permTarget.value) return;
  const leaves = checkedKeys.value.filter((id) => leafIds.value.has(id));
  saving.value = true;
  try {
    await assignRolePermissions(permTarget.value.id, leaves);
    message.success('已保存');
    permDialog.value = false;
  } finally {
    saving.value = false;
  }
}

// ── 表格列 ──────────────────────────────────────────────────
const columns: DataTableColumns<Role> = [
  { title: '角色名', key: 'name', minWidth: 140 },
  { title: '编码', key: 'code', minWidth: 140 },
  { title: '描述', key: 'description', minWidth: 200, ellipsis: { tooltip: true } },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row) {
      return h(
        NTag,
        { type: row.status === 1 ? 'success' : 'default', size: 'small', bordered: false },
        { default: () => (row.status === 1 ? '启用' : '停用') },
      );
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render(row) {
      const btn = (label: string, perm: string, type: 'primary' | 'error', onClick: () => void) =>
        h(
          NButton,
          {
            quaternary: true,
            type,
            size: 'tiny',
            // v-perm 指令对 render 函数不生效 —— 手动比对权限码集合，语义与指令一致
            style: auth.perms.has(perm) ? '' : 'display:none',
            onClick,
          },
          { default: () => label },
        );
      return h('div', { class: 'row-actions' }, [
        btn('编辑', 'sys:role:update', 'primary', () => openEdit(row)),
        btn('分配权限', 'sys:role:assignPerm', 'primary', () => openPerms(row)),
        btn('删除', 'sys:role:delete', 'error', () => remove(row)),
      ]);
    },
  },
];

onMounted(load);
</script>

<template>
  <n-card>
    <div class="toolbar">
      <n-input
        v-model:value="query.keyword"
        placeholder="角色名 / 编码"
        clearable
        class="search"
        @keyup.enter="search"
      />
      <n-button type="primary" @click="search">搜索</n-button>
      <div class="spacer" />
      <n-button v-perm="'sys:role:save'" type="primary" secondary @click="openCreate">
        新增角色
      </n-button>
    </div>

    <n-data-table
      remote
      :columns="columns"
      :data="rows"
      :loading="loading"
      :row-key="(r: Role) => r.id"
      :pagination="{ page: query.page, pageSize: query.pageSize, itemCount: total, onChange: (p: number) => { query.page = p; load(); } }"
    />
  </n-card>

  <n-modal
    v-model:show="dialogVisible"
    preset="card"
    :title="editingId === null ? '新增角色' : '编辑角色'"
    class="form-card"
    :bordered="false"
  >
    <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="80">
      <n-form-item label="角色名" path="name">
        <n-input v-model:value="form.name" />
      </n-form-item>
      <n-form-item label="编码" path="code">
        <n-input v-model:value="form.code" placeholder="如 OPERATOR" />
      </n-form-item>
      <n-form-item label="描述" path="description">
        <n-input v-model:value="form.description" type="textarea" :rows="2" />
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
    v-model:show="permDialog"
    preset="card"
    :title="`分配权限 · ${permTarget?.name ?? ''}`"
    class="form-card"
    :bordered="false"
  >
    <n-tree
      block-line
      checkable
      cascade
      default-expand-all
      :data="treeData"
      :checked-keys="checkedKeys"
      key-field="key"
      label-field="label"
      children-field="children"
      @update:checked-keys="(keys: number[]) => (checkedKeys = keys)"
    />
    <template #footer>
      <div class="form-actions">
        <n-button @click="permDialog = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="savePerms">保存</n-button>
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
