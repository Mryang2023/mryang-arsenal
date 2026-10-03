<script setup lang="ts">
// 根组件只做一件事：渲染路由出口。布局与页面在路由树里各就各位。
</script>

<template>
  <router-view />
</template>

<style>
/* 全局最小重置：管理端样貌交给 Element Plus，这里只保证高度撑满与基础字体 */
html,
body,
#app {
  height: 100%;
  margin: 0;
  font-family: 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f5f7fa;
}
</style>
