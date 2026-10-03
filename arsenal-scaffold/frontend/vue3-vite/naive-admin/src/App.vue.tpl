<script setup lang="ts">
// 根组件只做一件事：渲染路由出口。布局与页面在路由树里各就各位。
// 全局反馈（message / dialog）由 api/feedback.ts 的离散 API 承担，不在这里挂 Provider
// —— 离散 API 自带挂载点，视图、布局、axios 拦截器三层都能用同一套调用。
</script>

<template>
  <router-view />
</template>

<style>
/* 全局最小重置：管理端样貌交给 Naive UI，这里只保证高度撑满与基础字体 */
html,
body,
#app {
  height: 100%;
  margin: 0;
  font-family: 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f5f7fa;
}
</style>
