# -*- coding: utf-8 -*-
"""场景案例库（arsenal-cases）的事实源模块集合。

与 arsenal-cookbook 的分工（这句要一直留着，否则会有人问「为什么有两套」）：
    cookbook 回答「一个功能标准该怎么写」——无参数，直接看。
    cases    回答「在这些约束下该怎么设计」——选场景 + 调参数。

新增场景：写一个模块导出 CASE（形状照抄 huge_rowcount.py），
然后把模块名加进 **tools/build-content.py 的 CASES_MODULES**。
注意清单只有那一份 —— 本文件曾经也放过一份同名常量，没人读它，
结果是「加了新场景却什么都没发生」且不报错。
"""
