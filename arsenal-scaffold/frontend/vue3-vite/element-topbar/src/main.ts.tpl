import { createApp, type Component } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import * as Icons from '@element-plus/icons-vue';

import App from './App.vue';
import router from './router';
import perm from './directives/perm';

/**
 * 全量引入 Element Plus：管理端模板优先稳定可读，不做按需引入的构建优化；
 * 图标全量注册为全局组件，菜单/按钮用字符串名字引用（<component :is="'Edit'"/>）。
 */
const app = createApp(App);

app.use(createPinia()); // 必须先于 router：路由守卫里会用到 Pinia store
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.directive('perm', perm);
for (const [name, comp] of Object.entries(Icons)) {
  app.component(name, comp as Component);
}

app.mount('#app');
