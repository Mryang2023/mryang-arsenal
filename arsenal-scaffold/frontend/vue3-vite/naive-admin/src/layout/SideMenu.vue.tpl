<script setup lang="ts">
import { computed, h } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NIcon, type MenuOption } from 'naive-ui';
import type { SideMenuItem } from '@/types/api';

/**
 * 侧边菜单。Naive UI 的 n-menu 吃 options 数组而不是递归模板 ——
 * 这里把 SideMenuItem 树转成 MenuOption，选中 key = 路由 path，
 * 选中变化时 router.push（n-menu 没有 router 模式，跳转要自己接）。
 * 图标：静态菜单不带图标；动态菜单传入的 icon 字符串与组件库图标名
 * 不是一套体系，模板从简不渲染 —— 要图标就在这里挂自己的映射表。
 */
const props = defineProps<{ items: SideMenuItem[]; collapsed?: boolean }>();

const route = useRoute();
const router = useRouter();
const activeKey = computed(() => route.path);
void props;

function toOption(item: SideMenuItem): MenuOption {
  const opt: MenuOption = { label: item.label, key: item.path ?? item.label };
  if (item.children?.length) {
    opt.children = item.children.map(toOption);
  }
  return opt;
}

function renderGlyph() {
  // 占位图标：一个小方块，收起时顶级项不至于只剩孤零零的文字。
  // 换真图标时在这里挂自己的 icon 映射表（动态菜单的 icon 字符串与组件库不同体系）。
  return () => h(NIcon, null, { default: () => h('span', { class: 'glyph' }) });
}

const options: MenuOption[] = props.items.map((item) => {
  const opt = toOption(item);
  // 顶级项统一垫一个占位图标，收起时不至于只剩孤零零的文字
  if (!opt.children) opt.icon = renderGlyph();
  return opt;
});

function onSelect(key: string) {
  if (key.startsWith('/')) router.push(key);
}
</script>

<template>
  <n-menu
    class="menu"
    :value="activeKey"
    :options="options"
    :collapsed="props.collapsed"
    :collapsed-width="64"
    :indent="18"
    @update:value="onSelect"
  />
</template>

<style scoped>
.menu {
  border-right: none;
  flex: 1;
}
.menu :deep(.glyph) {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.55;
}
</style>
