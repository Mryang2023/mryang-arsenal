import { createApp } from 'vue';
import { createPinia } from 'pinia';
import naive from 'naive-ui';

import App from './App.vue';
import router from './router';
import perm from './directives/perm';

/**
 * 全量引入 Naive UI：管理端模板优先稳定可读，不做按需引入的构建优化。
 * 消息与确认框不依赖组件树里的 Provider —— 统一走 api/feedback.ts 的
 * 离散 API（createDiscreteApi），axios 拦截器里也能直接弹。
 */
const app = createApp(App);

app.use(createPinia()); // 必须先于 router：路由守卫里会用到 Pinia store
app.use(router);
app.use(naive);
app.directive('perm', perm);

app.mount('#app');
