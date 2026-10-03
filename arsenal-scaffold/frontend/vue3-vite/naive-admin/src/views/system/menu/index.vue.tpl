<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { NButton, NInputNumber, NSwitch, NTag, type DataTableColumns, type FormInst, type FormRules } from 'naive-ui';
import { dialog, message } from '@/api/feedback';
import { useAuthStore } from '@/stores/auth';
import { createMenu, deleteMenu, menuTree, updateMenu } from '@/api/menu';
import type { MenuTreeNode } from '@/types/api';

/**
 * 菜单管理：树形表格 + 新增/编辑。
 * 后端 v1 的菜单没有独立的「类型」字段：有 children 的节点渲染为子菜单，
 * 无 path 的叶子是按钮权限（只参与权限码，不进导航）—— 页面提示里写清楚。
 * n-data-table 的树形靠 rowKey + children 字段直出，不需要额外展开配置。
 */
const auth = useAuthStore();
const loading = ref(false);
const rows = ref<MenuTreeNode[]>([]);

async function load() {
  loading.value = true;
  try {
    rows.value = await menuTree();
  } finally {
    loading.value = false;
  }
}

const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInst>();
const form = reactive({
  parentId: 0,
  label: '',
  path: '',
  icon: '',
  permission: '',
  sortNo: 0,
  status: 1,
});
const rules: FormRules = {
  label: { required: true, message: '请输入名称', trigger: ['blur', 'input'] },
};

function openCreate(parent?: MenuTreeNode) {
  editingId.value = null;
  Object.assign(form, {
    parentId: parent?.id ?? 0,
    label: '',
    path: '',
    icon: '',
    permission: '',
    sortNo: (parent?.children?.length ?? 0) + 1,
    status: 1,
  });
  dialogVisible.value = true;
}
function openEdit(row: MenuTreeNode) {
  editingId.value = row.id;
  Object.assign(form, {
    parentId: row.parentId,
    label: row.label,
    path: row.path,
    icon: row.icon,
    permission: row.permission,
    sortNo: row.sortNo,
    status: row.status,
  });
  dialogVisible.value = true;
}
async function submit() {
  formRef.value
    ?.validate()
    .then(async () => {
      const payload = { ...form, path: form.path || undefined, permission: form.permission || undefined };
      if (editingId.value === null) {
        await createMenu(payload);
        message.success('已创建');
      } else {
        await updateMenu(editingId.value, payload);
        message.success('已保存');
      }
      dialogVisible.value = false;
      load();
    })
    .catch(() => {
      // 校验未通过：naive 已在字段旁标红，这里静默返回
    });
}
async function remove(row: MenuTreeNode) {
  if (row.children?.length) {
    message.warning('请先删除子节点');
    return;
  }
  dialog.warning({
    title: '删除确认',
    content: `确认删除菜单「${row.label}」？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await deleteMenu(row.id);
      message.success('已删除');
      load();
    },
  });
}

// ── 表格列 ──────────────────────────────────────────────────
function actionBtn(label: string, perm: string, type: 'primary' | 'error', onClick: () => void) {
  return h(
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
}

const columns: DataTableColumns<MenuTreeNode> = [
  { title: '名称', key: 'label', minWidth: 180 },
  { title: '路由 path', key: 'path', minWidth: 150 },
  { title: '权限码', key: 'permission', minWidth: 160 },
  { title: '排序', key: 'sortNo', width: 80 },
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
    width: 200,
    render(row) {
      return h('div', { class: 'row-actions' }, [
        actionBtn('加子项', 'sys:menu:save', 'primary', () => openCreate(row)),
        actionBtn('编辑', 'sys:menu:update', 'primary', () => openEdit(row)),
        actionBtn('删除', 'sys:menu:delete', 'error', () => remove(row)),
      ]);
    },
  },
];

onMounted(load);
</script>

<template>
  <n-card>
    <div class="toolbar">
      <span class="tip">有子节点渲染为子菜单；无 path 的叶子是按钮权限（不进导航）</span>
      <div class="spacer" />
      <n-button v-perm="'sys:menu:save'" type="primary" secondary @click="openCreate()">
        新增顶级菜单
      </n-button>
    </div>

    <n-data-table
      remote
      :columns="columns"
      :data="rows"
      :loading="loading"
      :row-key="(r: MenuTreeNode) => r.id"
      :children-key="'children'"
      :default-expand-all="true"
      :pagination="false"
    />
  </n-card>

  <n-modal
    v-model:show="dialogVisible"
    preset="card"
    :title="editingId === null ? '新增菜单' : '编辑菜单'"
    class="form-card"
    :bordered="false"
  >
    <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="90">
      <n-form-item label="名称" path="label">
        <n-input v-model:value="form.label" />
      </n-form-item>
      <n-form-item label="路由 path" path="path">
        <n-input v-model:value="form.path" placeholder="如 /system/user（按钮权限留空）" />
      </n-form-item>
      <n-form-item label="权限码" path="permission">
        <n-input v-model:value="form.permission" placeholder="如 sys:user:list" />
      </n-form-item>
      <n-form-item label="图标" path="icon">
        <n-input v-model:value="form.icon" placeholder="组件库图标名，可留空" />
      </n-form-item>
      <n-form-item label="排序" path="sortNo">
        <NInputNumber v-model:value="form.sortNo" :min="0" />
      </n-form-item>
      <n-form-item label="状态" path="status">
        <NSwitch v-model:value="form.status">
          <template #checked>启用</template>
          <template #unchecked>停用</template>
        </NSwitch>
      </n-form-item>
    </n-form>
    <template #footer>
      <div class="form-actions">
        <n-button @click="dialogVisible = false">取消</n-button>
        <n-button type="primary" @click="submit">确定</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.tip {
  font-size: 12px;
  color: #909399;
}
.spacer {
  flex: 1;
}
.form-card {
  width: 520px;
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
