# -*- coding: utf-8 -*-
"""脚手架装配台 · 前端选型与环境表单。

设计立场（2026-09-29 夜里改的，别「顺手」改回去）：
**前端选型不走维度体系，只作为 stack.json 顶层键。**
维度数与宽度分布被【17】视觉契约和 ProgressRing 格点阵钉死（33 维 / 3:1:29），
往 dimensions 里塞前端维度会连环炸掉一串已定型断言。前端选型是
「生成器的输入」而不是「架构装配的零件」——放顶层键语义上也更诚实。

envForms 声明「选了什么 → 出什么表单」：triggerDim/triggerOptions 命中才显示，
字段带默认值（占位符烘焙进生成物时保留 ${ENV:用户值} 形态，环境变量仍可覆盖）。
secret 字段默认不持久化，由前端 picks-store 落实。
"""

FRONTEND = {
    "bases": [
        {
            "id": "vue3-vite",
            "name": "Vue 3 + Vite + Element Plus",
            "badge": "完备",
            "summary": "登录 / 布局 / 动态菜单 / 用户·角色·菜单三管理页全量交付，勾选模块后导出即可用。",
        },
        {
            "id": "react-vite",
            "name": "React + Ant Design",
            "badge": "规划中",
            "uncovered": True,
            "summary": "模板在筹备。先占位防止误选 —— 选了它生成器会明确拒绝，而不是静默少给东西。",
        },
        {
            "id": "none",
            "name": "无前端（纯后端包）",
            "badge": "按需",
            "summary": "只导出 Spring Boot 后端包，不产出前端工程。",
        },
    ],
    # UI 模板（2026-10-03）：同一技术栈基底下的多套界面方案，按 base 分组。
    # 模板本体 = arsenal-scaffold/frontend/<base>/<templateId>/ 文件树（与 bases 同一载体），
    # default: true 的是 feUi 的兜底值 —— 换 base 或旧草稿没有该字段时都落回它。
    "templates": {
        "vue3-vite": [
            {
                "id": "element-admin",
                "name": "Element Plus · 经典侧边栏",
                "default": True,
                "summary": "深色侧边栏 + 面包屑顶栏的教科书式管理端，Element Plus 全家桶，与后端三管理页一一对应。",
            },
            {
                "id": "naive-admin",
                "name": "Naive UI · 清爽管理端",
                "summary": "同一套页面换 Naive UI 组件库：n-layout 折叠侧栏 + n-data-table 管理页，TS 类型更完整，暗色友好。",
            },
            {
                "id": "element-topbar",
                "name": "Element Plus · 顶栏导航",
                "summary": "组件库与 element-admin 相同，布局改横向顶栏导航 + 通栏内容区 —— 屏幕窄、层级浅的项目更合适。",
            },
        ],
    },
    "defaults": {
        "base": "vue3-vite",
        "lang": "ts",
        "state": "pinia",
        "http": "axios",
    },
}

ENV_FORMS = [
    {
        "id": "database",
        "triggerDim": "database",
        "triggerOptions": ["mysql", "postgres"],
        "title": "数据库连接",
        "fields": [
            {"key": "db.host", "label": "主机", "required": True, "default": "127.0.0.1", "placeholder": "127.0.0.1"},
            {"key": "db.port", "label": "端口", "required": True, "default": "3306",
             "defaultByOption": {"mysql": "3306", "postgres": "5432"}},
            {"key": "db.name", "label": "库名", "required": True, "default": "__APP_NAME__"},
            {"key": "db.username", "label": "用户名", "required": True, "default": "root"},
            {"key": "db.password", "label": "密码", "required": False, "default": "", "secret": True},
        ],
    },
    {
        "id": "redis",
        "triggerDim": "cache",
        "triggerOptions": ["redis"],
        "title": "Redis 连接",
        "fields": [
            {"key": "redis.host", "label": "主机", "required": True, "default": "127.0.0.1"},
            {"key": "redis.port", "label": "端口", "required": True, "default": "6379"},
            {"key": "redis.password", "label": "密码", "required": False, "default": "", "secret": True},
        ],
    },
    {
        "id": "registry",
        "triggerDim": "registry",
        "triggerOptions": ["nacos"],
        "title": "Nacos 注册中心",
        "fields": [
            {"key": "nacos.addr", "label": "地址", "required": True, "default": "127.0.0.1:8848"},
            {"key": "nacos.username", "label": "用户名", "required": True, "default": "nacos"},
            {"key": "nacos.password", "label": "密码", "required": False, "default": "nacos", "secret": True},
        ],
    },
]

# 装配台 → 生成器 的环境值键位说明（写给第四棒的 UI 与第五棒 E2E）：
#   db.* / redis.* / nacos.*  —— 直接对应 stack.json 各选项 yaml 里的 ${ENV:默认} 占位
#   __APP_NAME__ 默认值 —— 生成时替换为项目名（与 renderYaml 的库名跟随项目名一致）
