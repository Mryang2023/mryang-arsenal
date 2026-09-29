<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { createMenu, deleteMenu, menuTree, updateMenu } from '@/api/menu';
import type { MenuTreeNode } from '@/types/api';

/**
 * 菜单管理：树形表格 + 新增/编辑。
 * 后端 v1 的菜单没有独立的「类型」字段：有 children 的节点渲染为子菜单，
 * 无 path 的叶子是按钮权限（只参与权限码，不进导航）—— 页面提示里写清楚。
 */
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
const formRef = ref<FormInstance>();
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
  label: [{ required: true, message: '请输入名称', trigger: 'blur' }],
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
  const ok = await formRef.value
    ?.validate()
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  const payload = { ...form, path: form.path || undefined, permission: form.permission || undefined };
  if (editingId.value === null) {
    await createMenu(payload);
    ElMessage.success('已创建');
  } else {
    await updateMenu(editingId.value, payload);
    ElMessage.success('已保存');
  }
  dialogVisible.value = false;
  load();
}
async function remove(row: MenuTreeNode) {
  if (row.children?.length) {
    ElMessage.warning('请先删除子节点');
    return;
  }
  await ElMessageBox.confirm(`确认删除菜单「${row.label}」？`, '删除确认', { type: 'warning' });
  await deleteMenu(row.id);
  ElMessage.success('已删除');
  load();
}

onMounted(load);
</script>

<template>
  <el-card>
    <div class="toolbar">
      <span class="tip">有子节点渲染为子菜单；无 path 的叶子是按钮权限（不进导航）</span>
      <div class="spacer" />
      <el-button v-perm="'sys:menu:save'" type="primary" plain @click="openCreate()">新增顶级菜单</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="rows"
      row-key="id"
      :tree-props="{ children: 'children' }"
      default-expand-all
      stripe
    >
      <el-table-column prop="label" label="名称" min-width="180" />
      <el-table-column prop="path" label="路由 path" min-width="150" />
      <el-table-column prop="permission" label="权限码" min-width="160" />
      <el-table-column prop="sortNo" label="排序" width="80" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'">
            {{ row.status === 1 ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button v-perm="'sys:menu:save'" link type="primary" @click="openCreate(row)">加子项</el-button>
          <el-button v-perm="'sys:menu:update'" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-perm="'sys:menu:delete'" link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增菜单' : '编辑菜单'" width="520px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="名称" prop="label">
        <el-input v-model="form.label" />
      </el-form-item>
      <el-form-item label="路由 path" prop="path">
        <el-input v-model="form.path" placeholder="如 /system/user（按钮权限留空）" />
      </el-form-item>
      <el-form-item label="权限码" prop="permission">
        <el-input v-model="form.permission" placeholder="如 sys:user:list" />
      </el-form-item>
      <el-form-item label="图标" prop="icon">
        <el-input v-model="form.icon" placeholder="Element Plus 图标名，可留空" />
      </el-form-item>
      <el-form-item label="排序" prop="sortNo">
        <el-input-number v-model="form.sortNo" :min="0" />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-switch v-model="form.status" :active-value="1" :inactive-value="0" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submit">确定</el-button>
    </template>
  </el-dialog>
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
</style>
