# -*- coding: utf-8 -*-
"""案例库三层判据的**唯一**阈值表（W-0 共享判据）。

为什么要有这个文件：
    判据原先**写了两份** —— `tools/build-content.py` 的 `build_cookbook()` 一份、
    `arsenal-web/scripts/sync-content.mjs` 一份，两边各内联同一批「少于 N 条」
    的门槛。它们是同一套规矩的两个副本，却没有任何东西保证它们相等：
    改了 Python 那边忘了改 JS 那边，构建期放行、同步期拦截（或反过来），
    报错信息还会指向一份读者根本没看过的代码。

    案例库接下来要扩到 9 条主线（A-1），判据一定会随内容被反复调整 ——
    双写的代价不是「今天多改一处」，而是「将来每一次调整都可能只改一处」。

单一来源怎么落地（三处，缺一就是没做完）：
    ① 本文件的 `COOKBOOK_CONTRACT` 是唯一的定义处；
    ② `build_cookbook()` 读它做构建期校验，并把它写进
       `arsenal-cookbook/meta.json` 的 `contract` 字段；
    ③ `sync-content.mjs` 读 `meta.contract` 做同步期校验 ——
       **不再自己内联任何阈值**。

    Python 与 Node 是两种语言，共享不了「检查逻辑」，所以这里只共享
    **阈值**（判据的数字），逻辑仍各写一份 —— 这是刻意的边界：
    试图把逻辑也做成数据会造出一个没人看得懂的小型规则 DSL，
    而真正的风险（两边门槛不一致）已经由阈值单一来源消除了。

改判据的后果（想清楚再动）：
    调高 → 既有主线可能当场构建失败，这是**预期行为**，说明内容不够格；
    调低 → 已有内容不会被追溯检查，但新主线的门槛随之降低。
"""
from __future__ import unicode_literals

# 键名 = 被约束的字段名；值 = 下限（条数或字数，见注释）。
# ⚠️ 改这里就等于同时改 build 与 sync 两边 —— 不需要、也不许再去改第二处。
COOKBOOK_CONTRACT = {
    # ── L1 技术 ──────────────────────────────────────────────
    'intent': 30,        # intent 最少字数：说不清解决什么的技术不收录
    'pickWhen': 2,       # pickWhen 最少条数：只能比较 ≥2 个对手，才算「什么时候选它」
    'limits': 2,         # limits 最少条数：不写自身边界会被当成银弹
    'references': 2,     # references 最少条数：无出处不收录
    # ── L2 场景 ──────────────────────────────────────────────
    'when': 30,          # when 最少字数：说明不了什么情况下用
    'signals': 2,        # signals 最少条数：没有可核对信号，「适用」只是形容词
    'notSuitable': 2,    # notSuitable 最少条数：不写什么时候别用 = 没划边界
    'recipes': 1,        # 场景下的方案最少条数：场景不能悬空
    # ── L3 方案 ──────────────────────────────────────────────
    'approach': 20,      # approach 最少字数：说不清实现方式
    'files': 1,          # 代码文件最少个数：方案必须给得出代码
    'highlights': 2,     # 每个文件的要点备注最少数：少于 2 条说明这段代码没人真读过
    'checklist': 3,      # checklist 最少条数
    'pitfalls': 2,       # pitfalls 最少条数
    'observe': 2,        # lab.observe 最少条数（仅当 lab.kind == 'mock-endpoint'）
}

# 契约键的**顺序**也要单一来源：meta.json 里按这个顺序落盘，
# 否则每次构建都可能排出不同的键序，产出文件出现无意义的 diff。
CONTRACT_ORDER = (
    'intent', 'pickWhen', 'limits', 'references',
    'when', 'signals', 'notSuitable', 'recipes',
    'approach', 'files', 'highlights', 'checklist', 'pitfalls', 'observe',
)


def contract_doc():
    """按 CONTRACT_ORDER 排出有序的契约字典（供写盘与校验共用同一份对象）。"""
    assert set(CONTRACT_ORDER) == set(COOKBOOK_CONTRACT), (
        'CONTRACT_ORDER 与 COOKBOOK_CONTRACT 键集合不一致 —— 加判据要同时改两处')
    return {k: COOKBOOK_CONTRACT[k] for k in CONTRACT_ORDER}
