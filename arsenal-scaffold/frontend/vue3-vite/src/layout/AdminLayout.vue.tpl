<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import HeaderBar from './HeaderBar.vue';
import SideMenu from './SideMenu.vue';
import { sideMenus } from '@/router/menus';
import type { SideMenuItem } from '@/types/api';

/**
 * 管理端布局：左侧菜单 + 顶栏 + 内容区。
 * 菜单数据统一从 @/router/menus 拿 —— 生成器按选型装配静态或动态实现，
 * 布局层对两种形态无感。
 */
const route = useRoute();
const menus: SideMenuItem[] = sideMenus();
const currentTitle = computed(() => (route.meta?.title as string) ?? '');
</script>

<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="brand">{{ '管理端' }}</div>
      <SideMenu :items="menus" />
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="crumb">{{ currentTitle }}</span>
        <HeaderBar />
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}
.aside {
  background: #001529;
  display: flex;
  flex-direction: column;
}
.brand {
  color: #fff;
  font-weight: 600;
  text-align: center;
  padding: 18px 0;
  letter-spacing: 2px;
}
.header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
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
