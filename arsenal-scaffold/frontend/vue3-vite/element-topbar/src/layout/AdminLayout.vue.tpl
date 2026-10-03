<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import HeaderBar from './HeaderBar.vue';
import TopMenu from './TopMenu.vue';
import { sideMenus } from '@/router/menus';
import type { SideMenuItem } from '@/types/api';

/**
 * 管理端布局（顶栏导航式）：品牌 + 横向菜单 + 用户区挤一条顶栏，内容区通栏。
 * 与 element-admin 同一套组件库与数据源（@/router/menus），只换布局骨架 ——
 * 屏幕窄、层级浅的项目更合适；菜单多到一行放不下时横向收进 el-sub-menu 下拉。
 */
const route = useRoute();
const menus: SideMenuItem[] = sideMenus();
const currentTitle = computed(() => (route.meta?.title as string) ?? '');
</script>

<template>
  <el-container direction="vertical" class="layout">
    <el-header class="header" height="56px">
      <div class="brand">管理端</div>
      <TopMenu :items="menus" />
      <HeaderBar />
    </el-header>
    <el-header class="subheader" height="40px">
      <span class="crumb">{{ currentTitle }}</span>
    </el-header>
    <el-main class="main">
      <router-view />
    </el-main>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}
.header {
  background: #001529;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 20px;
}
.brand {
  color: #fff;
  font-weight: 600;
  letter-spacing: 2px;
  white-space: nowrap;
}
.subheader {
  background: #fff;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #e4e7ed;
}
.crumb {
  font-size: 15px;
  font-weight: 500;
}
.main {
  padding: 16px;
}
</style>
