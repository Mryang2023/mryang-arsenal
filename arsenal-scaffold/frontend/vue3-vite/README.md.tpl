# {{appName}} 管理端

Vue3 + Vite + TypeScript + Element Plus + Pinia 管理端，按当前选型由「脚手架装配台」生成。

## 两步起步

```bash
npm install
npm run dev        # http://localhost:5173
```

- 初始账号：**admin / admin123**（首次登录后请到「修改密码」改掉）。
- 后端默认在 {{backendBaseUrl}}；开发期 `/api` 请求由 vite 代理转发，无需改任何配置。
- 先起后端再开本页面：后端包的启动说明见其 README（本地 `mvn spring-boot:run` 即可）。

## 目录速览

```
src/api/        接口封装（http.ts 是 axios 实例：注入 token、统一拆包、401 跳登录）
src/stores/     Pinia（登录态 + 权限码集合）
src/router/     路由与守卫
src/layout/     布局框架（侧边菜单 + 顶栏）
src/views/      页面（首页 + 系统管理）
src/directives/ v-perm 按钮权限指令
```

## 权限怎么用

页面内按钮上加 `v-perm="'sys:user:delete'"`：当前登录用户没有该权限码时元素被移除。
权限码来自登录后返回的菜单树，角色分配在「系统管理 / 角色管理」里维护。
