<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import HeaderBar from './HeaderBar.vue';
import SideMenu from './SideMenu.vue';
import { sideMenus } from '@/router/menus';
import type { SideMenuItem } from '@/types/api';

/**
 * 管理端布局：可折叠侧边菜单 + 顶栏 + 内容区（Naive UI n-layout 体系）。
 * 菜单数据统一从 @/router/menus 拿 —— 生成器按选型装配静态或动态实现，
 * 布局层对两种形态无感。
 */
const route = useRoute();
const menus: SideMenuItem[] = sideMenus();
const currentTitle = computed(() => (route.meta?.title as string) ?? '');
const collapsed = ref(false);
</script>

<template>
  <n-layout class="layout" has-sider>
    <n-layout-sider
      bordered
      collapse-mode="width"
      :collapsed="collapsed"
      :collapsed-width="64"
      :width="220"
      :native-scrollbar="false"
      class="aside"
      show-trigger
      @update:collapsed="(v: boolean) => (collapsed = v)"
    >
      <div class="brand">{{ collapsed ? '管' : '管理端' }}</div>
      <SideMenu :items="menus" :collapsed="collapsed" />
    </n-layout-sider>
    <n-layout>
      <n-layout-header bordered class="header">
        <span class="crumb">{{ currentTitle }}</span>
        <HeaderBar />
      </n-layout-header>
      <n-layout-content class="main">
        <router-view />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<style scoped>
.layout {
  height: 100%;
}
.aside {
  background: #001529;
}
.brand {
  color: #fff;
  font-weight: 600;
  text-align: center;
  padding: 18px 0;
  letter-spacing: 2px;
  white-space: nowrap;
  overflow: hidden;
}
.header {
  background: #fff;
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.crumb {
  font-size: 15px;
  font-weight: 500;
}
.main {
  padding: 16px;
  height: calc(100% - 56px);
  overflow: auto;
}
</style>
