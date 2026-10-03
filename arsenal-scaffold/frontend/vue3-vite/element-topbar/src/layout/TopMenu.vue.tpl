<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { SideMenuItem } from '@/types/api';

/**
 * 顶栏横向菜单。递归渲染 SideMenuItem 树：有 children 渲染下拉子菜单，
 * 否则渲染可点项。开 router 模式后 el-menu-item 的 index 就是跳转目标，
 * 不要再加 click 处理 —— 两套导航叠在一起会推两次路由，浏览器后退键直接坏掉。
 * 横向模式下 el-sub-menu 自动渲染为悬浮下拉，一级项多时也不会挤爆顶栏。
 * icon 字段（Element Plus 图标名）由动态菜单传入时才可能存在；横向菜单从简不渲染。
 */
const props = defineProps<{ items: SideMenuItem[] }>();

const route = useRoute();
const activePath = computed(() => route.path);
void props;
</script>

<template>
  <el-menu
    class="menu"
    mode="horizontal"
    :default-active="activePath"
    background-color="#001529"
    text-color="#a6adb4"
    active-text-color="#ffffff"
    :ellipsis="true"
    router
  >
    <template v-for="item in props.items" :key="item.label">
      <el-sub-menu v-if="item.children?.length" :index="item.label">
        <template #title>
          <span>{{ item.label }}</span>
        </template>
        <el-menu-item
          v-for="child in item.children"
          :key="child.path ?? child.label"
          :index="child.path ?? child.label"
        >
          <span>{{ child.label }}</span>
        </el-menu-item>
      </el-sub-menu>
      <el-menu-item v-else :index="item.path ?? item.label">
        <span>{{ item.label }}</span>
      </el-menu-item>
    </template>
  </el-menu>
</template>

<style scoped>
.menu {
  flex: 1;
  min-width: 0;
  border-bottom: none;
}
</style>
