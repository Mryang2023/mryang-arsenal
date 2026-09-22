# -*- coding: utf-8 -*-
"""场景案例库（arsenal-cases）的事实源模块集合。

与 arsenal-cookbook 的分工（这句要一直留着，否则会有人问「为什么有两套」）：
    cookbook 回答「一个功能标准该怎么写」——无参数，直接看。
    cases    回答「在这些约束下该怎么设计」——选场景 + 调参数。

新增场景：写一个模块导出 CASE，再加进 CASES_MODULES。
"""
CASES_MODULES = ('cases/huge_rowcount', 'cases/genomic_sequence')
