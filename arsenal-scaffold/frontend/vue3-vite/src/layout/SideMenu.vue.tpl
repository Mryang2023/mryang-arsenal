<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { SideMenuItem } from '@/router/menus';

/**
 * 侧边菜单。递归渲染 SideMenuItem 树：有 children 渲染子菜单，否则渲染可点项。
 * 开 router 模式后 el-menu-item 的 index 就是跳转目标，不要再加 click 处理 ——
 * 两套导航叠在一起会推两次路由，浏览器后退键直接坏掉。
 * icon 字段（Element Plus 图标名）由动态菜单传入时才可能存在；静态菜单暂不配图标。
 */
const props = defineProps<{ items: SideMenuItem[] }>();

const route = useRoute();
const activePath = computed(() => route.path);
void props;
</script>

<template>
  <el-menu
    class="menu"
    :default-active="activePath"
    background-color="#001529"
    text-color="#a6adb4"
    active-text-color="#ffffff"
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
  border-right: none;
  flex: 1;
}
</style>
