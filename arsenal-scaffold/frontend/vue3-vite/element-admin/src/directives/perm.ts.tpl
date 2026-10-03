import type { Directive } from 'vue';
import { useAuthStore } from '@/stores/auth';

/**
 * v-perm="'sys:user:delete'"
 *
 * 按钮权限指令：当前用户权限码集合里没有该码时，直接把元素从 DOM 移除。
 * 用 remove 而不是 display:none —— 显示隐藏只是看不见，DOM 还在，
 * 控制台一行 CSS 就能让它回来；移除才真的不可达。
 * 权限码来自登录后的菜单树（按钮权限是叶子节点的 permission 字段）。
 */
const perm: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    const auth = useAuthStore();
    const code = binding.value;
    if (!code) return;
    if (!auth.perms.has(code)) {
      el.parentNode?.removeChild(el);
    }
  },
};

export default perm;
