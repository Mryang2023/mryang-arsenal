# -*- coding: utf-8 -*-
"""
内容资产生成器：把 tools/content/*.py 里定义的蓝图与选型数据写成 JSON。

为什么用生成器而不是手写 JSON：
    Java / YAML / XML 代码里全是双引号和换行，手写 JSON 字符串必须逐行转义，
    极易出错且不可读。这里在 Python 侧用三引号原样承载代码，
    只在这一处做一次序列化，产出干净的 JSON。

产出（都是 source of truth，直接进 Git）：
    arsenal-cookbook/*.json    端到端功能范例（垂直切片）
    arsenal-stacks/*.json      技术选型维度与选项
"""
import importlib.util
import itertools
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONTENT = os.path.join(HERE, 'content')

# 选型维度的来源模块。三处装配（选型台 / 架构图 / 项目结构）必须读同一份列表 ——
# 早先是三处各写一遍元组，加一个维度要改三行，漏一处就变成「选型台里有、
# 架构图里没有」这种只在运行时才暴露的不一致。
STACK_MODULES = ('stack_base', 'stack_data', 'stack_mw', 'stack_cross', 'stack_deploy',
                 # 全栈扩展：运行基石 / 数据生态 / 质量工程 / 运维安全 / 部署形态
                 'stack_runtime', 'stack_datax', 'stack_quality', 'stack_ops',
                 'stack_topology')

# 只提供画图元信息、不提供维度的模块（CANVAS_*_EXTRA 由 build_architecture 合并）
CANVAS_MODULES = ('stack_canvas_extra',)

# 场景案例库的来源模块（与 STACK_MODULES 同一套写法：加一个场景就在这里加一行，
# 漏了等于没写 —— 生成器不会去找目录里「碰巧存在」的文件）。
# ⚠️ 这是**唯一**的清单来源。content/cases/__init__.py 里曾经也有一份同名常量，
# 谁都不读它 —— 改了那边不报错，只是新场景静默不生成。已删除，不要再造第二份。
CASES_MODULES = (
    'cases/huge_rowcount',
    'cases/genomic_sequence',
    'cases/high_throughput_io',
    'cases/hotspot_cache',
    'cases/async_pipeline',
    'cases/wide_table_search',
    'cases/multi_source_ingestion',
    'cases/virtual_thread',
)

# Archify（通用绘图器）的组件类型枚举。写在这里是因为它是**对方**的词汇表：
# 我们只能往里映射，不能自己加第八类 —— 加了会在导出期被它的 JSON Schema 拒掉。
ARCHIFY_TYPES = {
    'frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external',
}


def load_module(name):
    path = os.path.join(CONTENT, name + '.py')
    spec = importlib.util.spec_from_file_location('c_' + name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write_json(rel_path, doc):
    full = os.path.join(ROOT, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    # newline='\n'：Windows 上默认文本模式会写成 CRLF，整文件假变更污染 diff
    with open(full, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    size = os.path.getsize(full)
    print('  %-44s %6.1f KB' % (rel_path, size / 1024))


# 案例库三层结构：技术（L1）→ 场景（L2）→ 实现方案（L3）。
# 加一项技术就在这里加一行 —— 与 CASES_MODULES 同一套写法，漏了等于没写。
COOKBOOK_MODULES = ('virtual_thread',)

# 技术族：只用于列表页筛选，不单独占一级页面 —— 层级就三层，不加第四层。
COOKBOOK_FAMILIES = {
    'concurrency': '并发',
    'data': '数据访问',
    'web': '接口与集成',
    'reliability': '稳定性',
    'quality': '质量工程',
}


def build_cookbook():
    """产出最佳实践案例库，并对三层结构逐层做完整性校验。

    结构上是三层：
        L1 技术      这个技术解决什么、什么时候该选它、它自身的边界
        L2 场景      在什么**情况**下用（带可核对信号，不是形容词）
        L3 实现方案  怎么搭：结构 / 代码 / 陷坑 / 模拟接口实测

    校验守两条底线：
      ① 每一层都要划边界 —— 只讲优点不划边界的范例，会诱导人在错误场景照抄。
      ② L3 的「模拟接口」必须是真接口：声明了 mock-endpoint 却用 sleep 假装 IO，
         pinning 与背压这类差异一个都暴露不出来，等于给了一个假的确定感。
    """
    print('[1/4] arsenal-cookbook —— 最佳实践案例库（技术 / 场景 / 方案）')
    topics = []
    problems = []
    known_rules = rule_ids()
    n_scen = n_recipe = n_demo = 0

    def check_refs(where, refs, minimum):
        refs = refs or []
        if len(refs) < minimum:
            problems.append('%s 的 references 少于 %d 条 —— 无出处不收录' % (where, minimum))
        for r in refs:
            if not r.get('title'):
                problems.append('%s 有参考资料缺少 title' % where)
            if not r.get('url') and not r.get('note'):
                problems.append('%s 的参考资料「%s」既没有链接也没有说明' % (where, r.get('title')))

    def check_perf(where, perf):
        width = len(perf.get('columns') or [])
        if width < 2:
            problems.append('%s 的 performance.columns 少于 2 列' % where)
        for row in perf.get('rows') or []:
            if len(row) != width:
                problems.append('%s 的 performance 有一行是 %d 列，表头是 %d 列'
                                % (where, len(row), width))
        if not (perf.get('rows') or []):
            problems.append('%s 的 performance 没有数据行' % where)
        if not perf.get('conclusion'):
            problems.append('%s 的 performance 没有结论 —— 只给表格不给判断，读者无法决策' % where)

    for name in COOKBOOK_MODULES:
        topic = load_module(name).TOPIC
        tid = topic.get('id', name)

        # ── L1 技术 ────────────────────────────────────────────
        if topic.get('family') not in COOKBOOK_FAMILIES:
            problems.append('技术 %s 的 family「%s」不在 %s 里'
                            % (tid, topic.get('family'), '/'.join(sorted(COOKBOOK_FAMILIES))))
        if len(topic.get('intent') or '') < 30:
            problems.append('技术 %s 的 intent 过于简略，说不清它解决什么' % tid)
        # 「外场选择」这一层的存在意义就是比较：至少给出两条与其它技术的取舍
        if len(topic.get('pickWhen') or []) < 2:
            problems.append(
                '技术 %s 的 pickWhen 少于 2 条 —— 说不出什么时候该选它，这一层就没有意义' % tid)
        for p in topic.get('pickWhen') or []:
            if not p.get('vs') or not p.get('text'):
                problems.append('技术 %s 有 pickWhen 缺少 vs 或 text' % tid)
        if len(topic.get('limits') or []) < 2:
            problems.append('技术 %s 的 limits 少于 2 条 —— 不写自身边界的技术会被当成银弹' % tid)
        check_refs('技术 %s' % tid, topic.get('references'), 2)

        # ── L2 场景 ────────────────────────────────────────────
        scenarios = topic.get('scenarios') or []
        if not scenarios:
            problems.append('技术 %s 一个场景都没有' % tid)
        seen_scen = set()
        for sc in scenarios:
            sid = sc.get('id')
            where = '%s/%s' % (tid, sid)
            if sid in seen_scen:
                problems.append('技术 %s 的场景 id 重复：%s' % (tid, sid))
            seen_scen.add(sid)
            if len(sc.get('when') or '') < 30:
                problems.append('%s 的 when 过于简略，说明不了什么情况下用' % where)
            if len(sc.get('signals') or []) < 2:
                problems.append('%s 的 signals 少于 2 条 —— 没有可核对信号，「适用」就只是形容词'
                                % where)
            if not sc.get('decision'):
                problems.append('%s 没有 decision（为什么在这个场景下用它）' % where)
            if len(sc.get('notSuitable') or []) < 2:
                problems.append('%s 的 notSuitable 少于 2 条' % where)

            # ── L3 实现方案 ────────────────────────────────────
            recipes = sc.get('recipes') or []
            if not recipes:
                problems.append('%s 没有任何实现方案 —— 场景不能悬空' % where)
            seen_recipe = set()
            for rp in recipes:
                rid = rp.get('id')
                at = '%s/%s' % (where, rid)
                if rid in seen_recipe:
                    problems.append('%s 的方案 id 重复：%s' % (where, rid))
                seen_recipe.add(rid)
                if len(rp.get('approach') or '') < 20:
                    problems.append('%s 的 approach 过于简略，说不清实现方式' % at)
                if len(rp.get('files') or []) < 1:
                    problems.append('%s 没有代码文件 —— 方案必须给得出代码' % at)
                for f in rp.get('files') or []:
                    if len(f.get('highlights') or []) < 2:
                        problems.append(
                            '%s/%s 只有 %d 条 highlights —— 少于 2 条说明这段代码没人真的读过'
                            % (at, f.get('id'), len(f.get('highlights') or [])))
                if len(rp.get('checklist') or []) < 3:
                    problems.append('%s 的 checklist 少于 3 条' % at)
                if len(rp.get('pitfalls') or []) < 2:
                    problems.append('%s 的 pitfalls 少于 2 条' % at)
                for r in rp.get('relatedRules') or []:
                    if r not in known_rules:
                        problems.append('%s 引用了不存在的规则 id：%s' % (at, r))
                if rp.get('performance'):
                    check_perf(at, rp['performance'])

                # 模拟接口测试：声明了 mock-endpoint，就得真起一个接口
                lab = rp.get('lab') or {}
                demos = rp.get('playground') or []
                if lab.get('kind') == 'mock-endpoint':
                    if not demos:
                        problems.append('%s 声明了模拟接口测试却没有可运行示例' % at)
                    if not lab.get('intro'):
                        problems.append('%s 的 lab 没有 intro（这组实验在测什么）' % at)
                    if len(lab.get('observe') or []) < 2:
                        problems.append('%s 的 lab.observe 少于 2 条 —— 不给预期现象，读者看不懂输出'
                                        % at)
                for d in demos:
                    if not d.get('id') or not d.get('label'):
                        problems.append('%s 有示例缺少 id 或 label' % at)
                    main_class = d.get('mainClass') or ''
                    if not main_class:
                        problems.append('%s/%s 没有声明 mainClass' % (at, d.get('id')))
                    files = d.get('files') or []
                    if not files:
                        problems.append('%s/%s 没有可提交的文件' % (at, d.get('id')))
                        continue
                    main_file = next(
                        (x for x in files if x.get('path') == '%s.java' % main_class), None)
                    if main_file is None:
                        problems.append('%s/%s 找不到入口文件 %s.java' % (at, d.get('id'), main_class))
                        continue
                    code = main_file.get('code') or ''
                    if 'public static void main' not in code:
                        problems.append('%s/%s 的入口类没有 main 方法' % (at, d.get('id')))
                    # 实测要对得上它声明的口径：说好跑模拟接口，就得真起 HttpServer；
                    # 说好测 per-thread 存储放大，就得真用 ThreadLocal。
                    for kind, needle, why in (
                        ('mock-endpoint', 'HttpServer',
                         '用 sleep 假装 IO，pinning 与背压的差异一个都测不出来'),
                        ('thread-local', 'ThreadLocal', '测不出 per-thread 存储被放大成多少份'),
                    ):
                        if lab.get('kind') == kind and needle not in code:
                            problems.append(
                                '%s/%s 声明了 %s 实测，但入口代码里没有 %s —— %s'
                                % (at, d.get('id'), kind, needle, why))
                    n_demo += 1
                n_recipe += 1
            n_scen += 1

        topics.append(topic)
        write_json('arsenal-cookbook/%s.json' % tid, {'topic': topic})

    if problems:
        print('\n[arsenal] 案例库数据校验失败：')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)

    write_json('arsenal-cookbook/meta.json', {
        'collection': 'arsenal-cookbook',
        'name': '军火库 · 最佳实践案例库',
        'version': '0.3.0',
        'releasedAt': '2026-09-24',
        'description': (
            '三层结构的照抄代码库：**技术**（这个技术解决什么、什么时候该选它）→ '
            '**场景**（在什么情况下用，带可核对信号）→ **实现方案**（结构 / 代码 / 陷坑 / '
            '模拟接口实测）。每一层都写清「什么时候不要这么写」，并标注对应军火库的哪几条规则。'
        ),
        'order': [t['id'] for t in topics],
        'count': len(topics),
        'scenarioCount': n_scen,
        'recipeCount': n_recipe,
        'demoCount': n_demo,
        'families': COOKBOOK_FAMILIES,
    })
    print('  %d 项技术 / %d 个场景 / %d 套实现方案 / %d 个可运行模拟接口实验'
          % (len(topics), n_scen, n_recipe, n_demo))


def build_stacks():
    print('[2/4] arsenal-stacks —— 技术选型')
    base = load_module('stack_base')
    dimensions = []
    for name in STACK_MODULES:
        dimensions.extend(load_module(name).DIMENSIONS)

    presets = load_module('stack_presets').PRESETS
    dim_ids = {d['id'] for d in dimensions}
    opt_ids = {d['id']: {o['id'] for o in d['options']} for d in dimensions}

    # 预设完整性校验：写错的选项 id 必须当场炸掉，不能静默少配一项
    problems = []
    for preset in presets:
        for dim, opt in preset['picks'].items():
            if dim not in dim_ids:
                problems.append('预设 %s 引用了不存在的维度 %s' % (preset['id'], dim))
            elif opt not in opt_ids[dim]:
                problems.append('预设 %s 的维度 %s 引用了不存在的选项 %s'
                                % (preset['id'], dim, opt))
    for dim in dimensions:
        if 'defaultOption' not in dim:
            problems.append('维度 %s 缺少 defaultOption' % dim['id'])
        elif dim['defaultOption'] not in opt_ids[dim['id']]:
            problems.append('维度 %s 的 defaultOption 不存在' % dim['id'])

    # 技术栈基底是**顶层全局声明**（不进 dimensions，故不走上面那套
    # NODE_ARCH / CANVAS 校验）。这里只守它自身的完整性：
    # 字段齐全、id 不重复、defaultBase 指向真实存在的基底。
    bases = getattr(base, 'BASES', [])
    if not bases:
        problems.append('技术栈基底 BASES 为空 —— 装配台将无基底可选')
    seen_bases = set()
    for b in bases:
        for k in ('id', 'name', 'vendor', 'version', 'status', 'covered'):
            if k not in b:
                problems.append('基底 %s 缺少字段 %s' % (b.get('id'), k))
        if b.get('id') in seen_bases:
            problems.append('基底 id 重复：%s' % b.get('id'))
        seen_bases.add(b.get('id'))
    default_base = getattr(base, 'DEFAULT_BASE', None)
    if default_base not in seen_bases:
        problems.append('DEFAULT_BASE %r 不在 BASES 里' % default_base)

    if problems:
        print('\n[arsenal] 选型数据校验失败：')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)

    # 分组：各扩展模块自带的组追加在基础组之后
    groups = list(base.GROUPS)
    seen_groups = {g['id'] for g in groups}
    for name in STACK_MODULES:
        mod = load_module(name)
        for g in getattr(mod, 'GROUPS_EXTRA', []):
            if g['id'] in seen_groups:
                problems.append('模块 %s 重复声明了分组 %s' % (name, g['id']))
                continue
            seen_groups.add(g['id'])
            groups.append(g)
    if problems:
        print('\n[arsenal] 选型数据校验失败：')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)

    # 集群形态：把 stack_topology.TOPOLOGY 挂到对应维度上。
    # 形态是**组件级**的（MySQL 和 PostgreSQL 都能跑主从），所以挂在维度上；
    # 个别选项想换默认形态，就在选项自己身上写 topologyDefault 覆盖。
    # "*" 表示该维度所有选项通用的形态表。
    topo_mod = load_module('stack_topology')
    topology_table = getattr(topo_mod, 'TOPOLOGY', {})
    for dim in dimensions:
        spec = topology_table.get(dim['id'])
        if not spec:
            continue
        for key, body in spec.items():
            if key == '*':
                dim['topology'] = body
                for opt in dim['options']:
                    opt.setdefault('topologyDefault', body['default'])
            else:
                for opt in dim['options']:
                    if opt['id'] == key:
                        opt['topology'] = body
                        opt.setdefault('topologyDefault', body['default'])
    # 形态表引用了不存在的维度 = 白写，直接炸
    for dim_id in topology_table:
        if dim_id not in dim_ids:
            print('\n[arsenal] 集群形态表引用了不存在的维度 %s' % dim_id)
            sys.exit(1)

    stack = {
        'collection': 'arsenal-stacks',
        'name': '军火库 · 技术选型与架构装配',
        'version': '0.1.0',
        'releasedAt': '2026-09-11',
        'description': (
            f'把一个 Spring Boot 项目拆成 {len(dimensions)} 个选型维度。勾选组合后，'
            '实时合成 pom 依赖、application.yml、必需的配置类与联动代码，'
            '并给出运维清单与冲突提示。'
        ),
        'groups': groups,
        'dimensions': dimensions,
        'bases': bases,
        'defaultBase': default_base,
        'presets': presets,
    }
    write_json('arsenal-stacks/stack.json', stack)

    opt_count = sum(len(d['options']) for d in dimensions)
    print('  %d 个维度 / %d 个选项 / %d 套预设'
          % (len(dimensions), opt_count, len(presets)))


def build_architecture():
    """产出架构图叠加层，并对它做一次严肃自检。

    这个自检不是走过场 —— 它守的是整张图的可拼装性：
    如果某个选项索要的能力没有任何选项提供，那么用户无论怎么选都拼不出可运行组合，
    界面上会永远显示「跑不起来」。这类数据错误必须在构建期炸掉，不能带到用户面前。
    """
    print('[3/4] arsenal-architecture —— 架构装配图')
    arch = load_module('stack_arch')
    dimensions = []
    for name in STACK_MODULES:
        dimensions.extend(load_module(name).DIMENSIONS)
    dim_ids = {d['id'] for d in dimensions}
    opt_ids = {d['id']: {o['id'] for o in d['options']} for d in dimensions}

    # ── 扩展层合并 ──────────────────────────────────────────
    # 全栈维度（runtime / datax / quality / ops / topology）的能力字典、槽位定义、
    # 能力供需、画图元信息都在各自的模块里，这里并进同一张表再校验。
    # 用「叠加」而不是改 stack_arch.py，是为了让两条工作线能同时演进而不冲突。
    for name in list(STACK_MODULES) + list(CANVAS_MODULES):
        mod = load_module(name)
        for cap_id, cap_name in getattr(mod, 'CAP_EXTRA', {}).items():
            if cap_id in arch.CAP_NAME:
                print('\n[arsenal] 模块 %s 重复登记了能力 %s' % (name, cap_id))
                sys.exit(1)
            arch.CAP_NAME[cap_id] = cap_name
        for dim_id, node in getattr(mod, 'NODE_ARCH_EXTRA', {}).items():
            if dim_id in arch.NODE_ARCH:
                print('\n[arsenal] 模块 %s 重复登记了槽位 %s' % (name, dim_id))
                sys.exit(1)
            arch.NODE_ARCH[dim_id] = node
        for dim_id, opts in getattr(mod, 'OPTION_ARCH_EXTRA', {}).items():
            if dim_id in arch.OPTION_ARCH:
                print('\n[arsenal] 模块 %s 重复登记了维度 %s 的能力声明' % (name, dim_id))
                sys.exit(1)
            arch.OPTION_ARCH[dim_id] = opts
        arch.CANVAS_DIMS.update(getattr(mod, 'CANVAS_DIMS_EXTRA', {}))
        arch.CANVAS_OPTIONS.update(getattr(mod, 'CANVAS_OPTIONS_EXTRA', {}))

    # 集群形态索要的能力也必须真有人提供 —— 否则用户切到那个形态就永远「跑不起来」，
    # 而界面上只会显示一句含糊的「缺零件」。
    topo_mod = load_module('stack_topology')
    for dim_id, spec in getattr(topo_mod, 'TOPOLOGY', {}).items():
        for body in spec.values():
            for mode in body['modes']:
                for cap_id in mode.get('requires', []):
                    if cap_id not in arch.CAP_NAME:
                        print('\n[arsenal] 集群形态 %s/%s 引用了未登记的能力 %s'
                              % (dim_id, mode['id'], cap_id))
                        sys.exit(1)

    lane_ids = {l['id'] for l in arch.LANES}
    cap_ids = set(arch.CAP_NAME)

    problems = []

    # ① 覆盖完整性：每个槽位、每个选项都必须有架构定义
    for dim in dimensions:
        if dim['id'] not in arch.NODE_ARCH:
            problems.append('维度 %s 缺少 NODE_ARCH 定义' % dim['id'])
            continue
        node = arch.NODE_ARCH[dim['id']]
        if node['lane'] not in lane_ids:
            problems.append('维度 %s 的泳道 %s 不存在' % (dim['id'], node['lane']))
        if dim['id'] in arch.OPTION_ARCH:
            declared = set(arch.OPTION_ARCH[dim['id']])
            for oid in opt_ids[dim['id']]:
                if oid not in declared:
                    problems.append('维度 %s 的选项 %s 缺少能力声明' % (dim['id'], oid))
            for oid in declared - opt_ids[dim['id']]:
                problems.append('维度 %s 声明了不存在的选项 %s' % (dim['id'], oid))
        else:
            problems.append('维度 %s 缺少 OPTION_ARCH 定义' % dim['id'])
    for dim in set(arch.NODE_ARCH) - dim_ids:
        problems.append('NODE_ARCH 里有孤儿槽位 %s' % dim)
    for dim in set(arch.OPTION_ARCH) - dim_ids:
        problems.append('OPTION_ARCH 里有孤儿维度 %s' % dim)
    for lane in arch.LANES:
        if not any(n['lane'] == lane['id'] for n in arch.NODE_ARCH.values()):
            problems.append('泳道 %s 下没有任何槽位' % lane['id'])

    # ② 能力引用完整性
    provided = set()
    for dim, opts in arch.OPTION_ARCH.items():
        for oid, spec in opts.items():
            for c in spec.get('provides', []) + spec.get('requires', []):
                if c not in cap_ids:
                    problems.append('%s/%s 引用了未登记的能力 %s' % (dim, oid, c))
            provided |= set(spec.get('provides', []))
    for dim, opts in arch.OPTION_ARCH.items():
        for oid, spec in opts.items():
            for c in spec.get('requires', []):
                if c not in provided:
                    problems.append(
                        '%s/%s 索要能力 %s，但没有任何选项能提供它 —— 该组合永远拼不出来'
                        % (dim, oid, c))

    # ③ 自足性检查：一个能力如果只能由某个槽位提供，而该槽位的某个选项又索要它，
    #    那么选中那个选项时它必然缺失 —— 这是「向自己索要」，属于数据错误。
    #    （真实案例：「Actuator + Prometheus」曾写成需要 cap.metrics，
    #      而 cap.metrics 的唯一提供者就是它所在的可观测性槽位，永远拼不出来。）
    cap_owner = {}
    for dim, opts in arch.OPTION_ARCH.items():
        for spec in opts.values():
            for c in spec.get('provides', []):
                cap_owner.setdefault(c, set()).add(dim)
    for dim, opts in arch.OPTION_ARCH.items():
        for oid, spec in opts.items():
            for c in spec.get('requires', []):
                if cap_owner.get(c) == {dim}:
                    problems.append(
                        '%s/%s 索要能力 %s，而该能力的唯一提供者就是它自己所在的槽位 %s'
                        ' —— 向自己索要，用户永远拼不出可运行组合' % (dim, oid, c, dim))

    # ③·五 画图元信息：维度 / 选项 / 连线端点都必须真实存在
    #
    # 守的是「图上的东西都是真的」：连线端点写错一个字母，图上就多一条
    # 谁也连不上的线；选项表里漏一个维度，那个槽位就会掉成通用灰块 ——
    # 两种都不会报错，只有看图的人会发现。所以必须在构建期拦。
    zone_ids = set(z['id'] for z in arch.CANVAS_ZONES)
    # 每个分区都要说清自己属于哪一类 —— 不给默认值，是为了让「这一层算什么」
    # 成为一个必须被写下来的判断，而不是渲染器里一个有朝一日会被改错的分支。
    for zone in arch.CANVAS_ZONES:
        if zone.get('archifyType') not in ARCHIFY_TYPES:
            problems.append('CANVAS_ZONES/%s 的 archifyType %r 不在 %s 里'
                            % (zone.get('id'), zone.get('archifyType'),
                               '/'.join(sorted(ARCHIFY_TYPES))))
    # 图例覆盖只能改**已有类型**的文字，不能凭空造一个类型
    for kind, entry in getattr(arch, 'CANVAS_LEGEND_OVERRIDES', {}).items():
        if kind not in ARCHIFY_TYPES:
            problems.append('CANVAS_LEGEND_OVERRIDES 里的 %r 不是组件类型' % kind)
        if not entry.get('label'):
            problems.append('CANVAS_LEGEND_OVERRIDES/%s 没有给 label' % kind)

    # 阅读路径：焦点只能声明真实存在的分区与维度 —— 写错一个字母，
    # 那条路径会静默地少亮一块，或者整条消失，而没有任何东西报错。
    seen_views = set()
    for view in getattr(arch, 'CANVAS_VIEWS', []):
        vid = view.get('id')
        if not re.match(r'^[a-zA-Z][a-zA-Z0-9_-]*$', str(vid)):
            problems.append('CANVAS_VIEWS 里的 id %r 不符合规范' % vid)
        if vid in seen_views:
            problems.append('CANVAS_VIEWS 里有重复的 id %s' % vid)
        seen_views.add(vid)
        if not view.get('label'):
            problems.append('CANVAS_VIEWS/%s 没有 label' % vid)
        if not view.get('zones') and not view.get('dims'):
            problems.append('CANVAS_VIEWS/%s 既没声明分区也没声明维度 —— 它的焦点永远是空的'
                            % vid)
        for z in view.get('zones', []):
            if z not in zone_ids:
                problems.append('CANVAS_VIEWS/%s 引用了不存在的分区 %s' % (vid, z))
        for d in view.get('dims', []):
            if d not in dim_ids:
                problems.append('CANVAS_VIEWS/%s 引用了不存在的维度 %s' % (vid, d))
        # 对方的 schema 把 note 卡在 140 字
        if len(view.get('note') or '') > 140:
            problems.append('CANVAS_VIEWS/%s 的 note 超过 140 字' % vid)
    # 'client' 与 'app' 是固定节点，不属于任何选型维度
    link_ok = set(opt_ids) | {'client', 'app'}

    for dim_id, spec in arch.CANVAS_DIMS.items():
        if dim_id not in opt_ids:
            problems.append('CANVAS_DIMS 里有不存在的维度 %s' % dim_id)
        if spec.get('place') == 'node' and spec.get('zone') not in zone_ids:
            problems.append('CANVAS_DIMS/%s 的 zone %r 不在 CANVAS_ZONES 里'
                            % (dim_id, spec.get('zone')))
    for dim_id in opt_ids:
        if dim_id not in arch.CANVAS_DIMS:
            problems.append('维度 %s 没有声明在图上怎么出现（CANVAS_DIMS 缺它）' % dim_id)

    for dim_id, opts in arch.CANVAS_OPTIONS.items():
        if dim_id not in opt_ids:
            problems.append('CANVAS_OPTIONS 里有不存在的维度 %s' % dim_id)
            continue
        for oid, spec in opts.items():
            if oid not in opt_ids[dim_id]:
                problems.append('CANVAS_OPTIONS/%s 里有不存在的选项 %s' % (dim_id, oid))
            if not spec.get('icon'):
                problems.append('CANVAS_OPTIONS/%s/%s 没有指定图标' % (dim_id, oid))
            for mode in spec.get('cluster', []):
                if not isinstance(mode.get('replicas'), int) or mode['replicas'] < 1:
                    problems.append('CANVAS_OPTIONS/%s/%s 的集群形态 %r 副本数不是正整数'
                                    % (dim_id, oid, mode.get('name')))
            # archifyType 是封闭枚举 —— 渲染器的词汇表就这么七个，编第八个会在
            # 导出期被 JSON Schema 拒掉。这里提前拦，报错能指到具体哪个选项。
            atype = spec.get('archifyType')
            if atype is not None and atype not in ARCHIFY_TYPES:
                problems.append('CANVAS_OPTIONS/%s/%s 的 archifyType %r 不在 %s 里'
                                % (dim_id, oid, atype, '/'.join(sorted(ARCHIFY_TYPES))))
            # brand 必须是 Archify 商标库里的规范 id 形状。**是否真实存在**由
            # `npm run verify:archify` 拿真实商标库核对 —— 构建脚本不该依赖那个技能。
            brand = spec.get('brand')
            if brand is not None and not re.match(r'^[a-z0-9][a-z0-9-]*$', str(brand)):
                problems.append('CANVAS_OPTIONS/%s/%s 的 brand %r 不是规范 id 形状'
                                '（小写字母 / 数字 / 连字符，如 apache-kafka）'
                                % (dim_id, oid, brand))
    for dim_id in opt_ids:
        if dim_id not in arch.CANVAS_OPTIONS:
            problems.append('维度 %s 没有画图元信息（CANVAS_OPTIONS 缺它）' % dim_id)

    for link in arch.CANVAS_LINKS:
        for side in ('from', 'to'):
            if link[side] not in link_ok:
                problems.append('CANVAS_LINKS 的 %s 端 %r 不是维度也不是固定节点'
                                % (side, link[side]))

    # ④ 策略引用完整性
    for pol in arch.POLICIES:
        for dim, opts in pol.get('when', {}).items():
            if dim not in dim_ids:
                problems.append('策略 %s 引用了不存在的维度 %s' % (pol['id'], dim))
                continue
            for o in opts:
                if o not in opt_ids[dim]:
                    problems.append('策略 %s 引用了不存在的选项 %s/%s' % (pol['id'], dim, o))
        for n in pol.get('nodes', []):
            if n not in dim_ids:
                problems.append('策略 %s 的 nodes 引用了不存在的槽位 %s' % (pol['id'], n))
        if pol['level'] not in ('blocker', 'risk', 'note'):
            problems.append('策略 %s 的 level 非法：%s' % (pol['id'], pol['level']))
    seen = set()
    for pol in arch.POLICIES:
        if pol['id'] in seen:
            problems.append('策略 id 重复：%s' % pol['id'])
        seen.add(pol['id'])
    for pid in arch.PRESET_NOTES:
        if pid not in {p['id'] for p in load_module('stack_presets').PRESETS}:
            problems.append('PRESET_NOTES 引用了不存在的预设 %s' % pid)

    # ⑤ 层内流水线：只允许声明该泳道内的槽位（可以是不含旁路件子集），
    #    未列入的槽位由前端排在流水线之后。写错槽位会画出错误的链路。
    for lane_id, order in arch.PIPELINES.items():
        members = [d for d in dim_ids if arch.NODE_ARCH[d]['lane'] == lane_id]
        stray = [x for x in order if x not in members]
        if stray:
            problems.append('泳道 %s 的流水线引用了不属于该泳道的槽位：%s' % (lane_id, stray))
        if len(set(order)) != len(order):
            problems.append('泳道 %s 的流水线存在重复槽位' % lane_id)
        unknown = [x for x in order if x not in dim_ids]
        if unknown:
            problems.append('泳道 %s 的流水线引用了不存在的槽位：%s' % (lane_id, unknown))

    if problems:
        print('\n[arsenal] 架构图数据校验失败：')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)

    doc = {
        'collection': 'arsenal-architecture',
        'version': '0.1.0',
        'releasedAt': '2026-09-11',
        'description': (
            '把 %d 个选型维度还原成一张可装配的架构图。每个零件声明它提供什么能力、'
            '需要什么能力，校验时求一次能力并集，就能算出这套组合能不能跑起来、缺的是哪一块。'
        ) % len(dim_ids),
        'lanes': arch.LANES,
        'capNames': arch.CAP_NAME,
        'nodes': arch.NODE_ARCH,
        'options': arch.OPTION_ARCH,
        'pipelines': arch.PIPELINES,
        'policies': arch.POLICIES,
        # 隐患详情与策略分开存：策略说「什么时候命中」，详情说「命中了说明会发生什么」。
        # 界面上一张卡片要用到两边，所以都发出去。
        'policyDetail': arch.POLICY_DETAIL,
        'presetNotes': arch.PRESET_NOTES,
        # 交付用技术架构图的画图元信息。与能力模型分开存：前者回答「能不能跑」，
        # 这个回答「画出来是什么样」。混在一起会让版式字段污染判定逻辑。
        'canvas': {
            'zones': arch.CANVAS_ZONES,
            'dims': arch.CANVAS_DIMS,
            'options': arch.CANVAS_OPTIONS,
            'links': arch.CANVAS_LINKS,
            # 导出给通用绘图器时的图例文字覆盖。带上它是为了不让图例说错话：
            # Archify 的 cloud 类显示成「云服务」，而我们这一层装的是自托管组件。
            'legend': getattr(arch, 'CANVAS_LEGEND_OVERRIDES', {}),
            # 阅读路径。焦点用分区 / 维度声明，不写死节点 id
            'views': getattr(arch, 'CANVAS_VIEWS', []),
        },
    }
    write_json('arsenal-stacks/architecture.json', doc)

    n_pol = len(arch.POLICIES)
    by_level = {}
    for p in arch.POLICIES:
        by_level[p['level']] = by_level.get(p['level'], 0) + 1
    print('  %d 条泳道 / %d 个槽位 / %d 项能力 / %d 条策略 %s'
          % (len(arch.LANES), len(arch.NODE_ARCH), len(arch.CAP_NAME), n_pol,
             by_level))


def build_project():
    """产出项目结构层，并做交叉校验。

    这一步的校验重点不是「格式对不对」，而是**结构树和选型数据是不是同一套事实**。
    结构树里写了 MybatisPlusConfig.java，选型数据里就必须真的有这个配置类；
    反过来，选型数据产出了配置类，结构树里却找不到它，也说明两边脱节了。
    这类错误在界面上表现为「图很好看，但照着建出来的目录是错的」——
    必须构建期炸掉。
    """
    print('[4/4] arsenal-project —— 项目结构与导出文件')
    arch = load_module('stack_arch')
    proj = load_module('stack_project')
    dimensions = []
    for name in STACK_MODULES:
        dimensions.extend(load_module(name).DIMENSIONS)
    dim_ids = {d['id'] for d in dimensions}
    opt_ids = {d['id']: {o['id'] for o in d['options']} for d in dimensions}

    # 选型数据里真实存在的配置类名 —— 用于校验结构树没有写错文件名。
    # 只认带真实路径的条目：有些 configClasses 是「用法示例」（path 写的是说明文字），
    # 它们不落在磁盘上，不该被要求出现在目录树里。
    config_class_names = set()
    for d in dimensions:
        for o in d['options']:
            for c in (o.get('configClasses') or []):
                if c.get('path', '').endswith('.java'):
                    config_class_names.add(c['className'])

    problems = []

    def check_when(cond, where):
        for dim, opts in (cond or {}).items():
            if dim not in dim_ids:
                problems.append('%s 引用了不存在的维度 %s' % (where, dim))
                continue
            for o in opts:
                if o not in opt_ids[dim]:
                    problems.append('%s 引用了不存在的选项 %s/%s' % (where, dim, o))

    # ── ① 隐患详情必须与策略一一对应 ───────────────────────
    policy_ids = {p['id'] for p in arch.POLICIES}
    for pid in sorted(policy_ids - set(arch.POLICY_DETAIL)):
        problems.append('策略 %s 缺少隐患详情（trigger / symptoms / impact）' % pid)
    for pid in sorted(set(arch.POLICY_DETAIL) - policy_ids):
        problems.append('POLICY_DETAIL 里有孤儿条目 %s，没有对应的策略' % pid)
    for pid, det in arch.POLICY_DETAIL.items():
        for key in ('trigger', 'symptoms', 'impact'):
            if not det.get(key):
                problems.append('策略 %s 的 %s 是空的' % (pid, key))
        if len(det.get('symptoms') or []) < 2:
            problems.append(
                '策略 %s 的可观察现象少于 2 条 —— 写不出可核对现象的，不该当隐患报出来' % pid)

    # ── ② 结构树 ───────────────────────────────────────────
    exempt_badges = {'所有项目', '可选', '导出附带'}
    stats = {'dir': 0, 'file': 0}

    def walk(nodes, path, parent):
        names = [n['name'] for n in nodes]
        dup = sorted({x for x in names if names.count(x) > 1})
        if dup:
            problems.append('目录 %s 下有重名节点 %s' % (parent, dup))
        for n in nodes:
            here = (path + '/' + n['name']) if path else n['name']
            check_when(n.get('when'), '结构树节点 %s' % here)
            if n['kind'] == 'dir':
                stats['dir'] += 1
                if not n['name'].endswith('/'):
                    problems.append('目录节点 %s 的名字缺少结尾斜杠' % here)
                if not n['children']:
                    problems.append('目录节点 %s 没有任何子节点，画出来是个空壳' % here)
                walk(n['children'], here.rstrip('/'), here)
            else:
                stats['file'] += 1
                if n['name'].endswith('/'):
                    problems.append('文件节点 %s 的名字不该以斜杠结尾' % here)
                if not n.get('desc'):
                    problems.append('文件节点 %s 没有职责说明' % here)
                in_config = ('/config/' in (here + '/'))
                if (in_config and n.get('badge') and n['badge'] not in exempt_badges
                        and n['name'].endswith('.java')):
                    cls = n['name'][:-5]
                    if cls not in config_class_names:
                        problems.append(
                            '结构树里的 %s 标了来源「%s」，但选型数据里没有任何选项产出这个配置类'
                            % (here, n['badge']))

    walk(proj.TREE['children'], proj.TREE['name'].rstrip('/'), proj.TREE['name'])

    # 反向检查：选型数据产出的配置类，是否都能在结构树里找到位置
    tree_text = json.dumps(proj.TREE, ensure_ascii=False)
    for cls in sorted(config_class_names):
        if ('%s.java' % cls) not in tree_text:
            problems.append(
                '选型数据产出了配置类 %s，但结构树里没有它的位置 —— 两份数据已经脱节' % cls)

    # ── ③ 启动类与开关归属 ─────────────────────────────────
    for a in proj.APP_ANNOTATIONS:
        check_when(a.get('when'), '启动类注解 %s' % a['code'])
        if not a.get('import'):
            problems.append('启动类注解 %s 没有声明 import' % a['code'])
    seen_switches = set()
    for s in proj.SWITCH_OWNERS:
        check_when(s.get('when'), '开关归属 %s' % s['switch'])
        if not s.get('owner') or not s.get('why'):
            problems.append('开关归属 %s 缺少归属方或作用说明' % s['switch'])
        key = (s['switch'], s['owner'])
        if key in seen_switches:
            problems.append('开关归属表里 %s → %s 重复' % key)
        seen_switches.add(key)

    # ── ④ 模板占位符：漏一个，导出的文件里就会留一段 __XXX__ ──
    known_readme = {'__SELECTION_TABLE__', '__ARCH_SUMMARY__', '__TREE__', '__START__',
                    '__RISKS__', '__DANGLING__', '__FILES__'}
    known_app = {'__IMPORTS__', '__SWITCHES__', '__ANNOTATIONS__'}
    for tpl, known, label in (
        (proj.README_TEMPLATE, known_readme, 'README 模板'),
        (proj.APP_TEMPLATE, known_app, '启动类模板'),
    ):
        found = set(re.findall(r'__[A-Z_]+__', tpl))
        if found - known:
            problems.append('%s 里有前端不会替换的占位符：%s' % (label, sorted(found - known)))
        if known - found:
            problems.append('%s 缺少占位符：%s' % (label, sorted(known - found)))

    # ── ⑤ 结构原则必须挂到真实存在的规则 id ─────────────────
    rule_ids = set()
    rules_dir = os.path.join(ROOT, 'arsenal-rules')
    for root_dir, _dirs, files in os.walk(rules_dir):
        for fn in files:
            if not fn.endswith('.json') or fn == 'rule.schema.json':
                continue
            with open(os.path.join(root_dir, fn), encoding='utf-8') as f:
                data = json.load(f)
            for r in (data.get('rules') or []):
                rule_ids.add(r['id'])
    for note in proj.STRUCTURE_NOTES:
        if note.get('rule') and note['rule'] not in rule_ids:
            problems.append('结构原则「%s」引用了不存在的规则 %s'
                            % (note['title'], note['rule']))

    if problems:
        print('\n[arsenal] 项目结构数据校验失败：')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)

    doc = {
        'collection': 'arsenal-project',
        'version': '0.2.0',
        'releasedAt': '2026-09-11',
        'description': (
            '把选型结果还原成一棵真实目录树。选 MyBatis-Plus 就有 resources/mapper/，'
            '选 Flyway 就有 db/migration/，选 Gradle 就没有 pom.xml —— '
            '结构跟着选型变，而不是给一份固定模板让人照着建空目录。'
        ),
        'groupId': proj.GROUP_ID,
        'artifactId': proj.ARTIFACT_ID,
        'basePackage': proj.BASE_PACKAGE,
        'tree': proj.TREE,
        'appTemplate': proj.APP_TEMPLATE,
        'appAnnotations': proj.APP_ANNOTATIONS,
        'switchOwners': proj.SWITCH_OWNERS,
        'files': {
            'gitignore': proj.GITIGNORE,
            'flywayV1': proj.FLYWAY_V1,
            'liquibaseMaster': proj.LIQUIBASE_MASTER,
            'smokeTest': proj.SMOKE_TEST,
            'gradleSettings': proj.GRADLE_SETTINGS,
            'readmeTemplate': proj.README_TEMPLATE,
            'readmeStartMaven': proj.README_START_MANUAL,
            'readmeStartGradle': proj.README_START_GRADLE,
        },
        'structureNotes': proj.STRUCTURE_NOTES,
        'structureLegend': proj.STRUCTURE_LEGEND,
    }
    write_json('arsenal-stacks/project.json', doc)
    print('  %d 个目录 / %d 个文件节点 / %d 条结构原则 / %d 条开关归属'
          % (stats['dir'], stats['file'], len(proj.STRUCTURE_NOTES), len(proj.SWITCH_OWNERS)))


def build_icons():
    """产出图标资产库索引。

    这一层守的是「登记的东西真的存在」—— 图标库最容易烂成一本目录册：
    JSON 里写着 81 个，页面能列出 81 行，点开一半是灰方块。所以这里
    三条硬校验一条都不能省：

      ① vector key 必须在 tech-icons.ts 里真有一段图形（拼错 = 静默回落 generic）
      ② bitmap 非空时，文件必须在 public/icons/ 下真的存在（拼错 = 页面破图）
      ③ bitmap 不许绝对路径、不许 `..`（这类路径会被当成文件遍历用）

    反过来「public/icons 下的孤儿文件」由 sync-content.mjs 抓：
    生成器这侧看得到图标清单，看不到磁盘上多出来的图。
    """
    print('[5/5] arsenal-icons —— 图标资产库')
    mod = load_module('icons')
    icons = mod.ICONS
    cats = mod.CATEGORIES
    problems = []

    # ① 矢量 key 必须在 tech-icons.ts 里真有一段图形
    ts_path = os.path.join(ROOT, 'arsenal-web', 'src', 'lib', 'tech-icons.ts')
    if not os.path.exists(ts_path):
        problems.append('找不到 arsenal-web/src/lib/tech-icons.ts —— 矢量图标的事实源')
        vector_keys = set()
    else:
        with open(ts_path, encoding='utf-8') as f:
            ts_src = f.read()
        # 只认两层缩进的顶层条目，避免把 name/color/kind 这些字段也算成图标
        vector_keys = set()
        for m in re.finditer(r'^ {2}(\'([a-z0-9-]+)\'|([a-z0-9]+)): \{$', ts_src, re.M):
            vector_keys.add(m.group(2) or m.group(3))

    cat_ids = [c['id'] for c in cats]
    accent_of = {c['id']: c['accent'] for c in cats}
    public_icons = os.path.join(ROOT, 'arsenal-web', 'public', 'icons')

    seen = {}
    for ic in icons:
        at = '图标 %s' % ic.get('key')
        key = ic.get('key') or ''
        if not re.match(r'^[a-z][a-z0-9-]*$', key):
            problems.append('%s 的 key 不合法（只允许小写字母/数字/横线，且字母开头）' % at)
        if key in seen:
            problems.append('%s 的 key 与前面某条重复' % at)
        seen[key] = True

        if ic.get('category') not in cat_ids:
            problems.append('%s 的 category「%s」不在九大类内' % (at, ic.get('category')))
        if not ic.get('name') or not ic.get('en'):
            problems.append('%s 缺少中文名或英文名' % at)
        if not ic.get('tags'):
            problems.append('%s 没有标签 —— 搜不到等于没有' % at)

        vec = ic.get('vector') or ''
        if not vec:
            problems.append('%s 没有矢量 key —— 架构图上会是一个灰方块' % at)
        elif vec not in vector_keys:
            problems.append('%s 指向的矢量 key「%s」在 tech-icons.ts 里不存在' % (at, vec))

        bmp = ic.get('bitmap') or ''
        if bmp:
            if bmp.startswith('/') or '..' in bmp or re.match(r'^[A-Za-z]:', bmp):
                problems.append('%s 的 bitmap 路径不合法（不许绝对路径或 ..）：%s' % (at, bmp))
            elif not bmp.endswith(('.png', '.webp')):
                problems.append('%s 的 bitmap 必须是 .png/.webp：%s' % (at, bmp))
            else:
                full = os.path.join(public_icons, bmp.replace('/', os.sep))
                if not os.path.exists(full):
                    problems.append('%s 登记了位图但磁盘上没有：public/icons/%s' % (at, bmp))
                # 目录前缀必须等于自己的 category。同步脚本只查「存在 + 路径合法」，
                # 所以「图在 compute/ 下、图标却归在 actor」这种错两侧都不会响：
                # 页面按分组去找它，找到的是另一个目录下的名字 —— 表现是灰方块，
                # 而错误信息指向「文件不存在」，跟真正的错因差了十万八千里。
                elif bmp.split('/')[0] != ic.get('category'):
                    problems.append(
                        '%s 的位图目录「%s」与它的 category「%s」不一致：%s'
                        % (at, bmp.split('/')[0], ic.get('category'), bmp)
                    )

    # ② 九大类不能空着 —— 空分类在侧栏上就是一个点了没反应的按钮
    for cid in cat_ids:
        if not [x for x in icons if x.get('category') == cid]:
            problems.append('分类 %s 一个图标都没有' % cid)

    if problems:
        print('\n[arsenal] 图标资产库数据校验失败：')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)

    with_bitmap = [x for x in icons if x.get('bitmap')]
    write_json('arsenal-icons/icons.json', {
        'collection': 'arsenal-icons',
        'name': '军火库 · 图标资产库',
        'version': '0.1.0',
        'description': (
            '画架构图会用到的图标。矢量（tech-icons.ts）供架构图节点、装配台与 IR 组件使用，'
            '位图（public/icons/**）供卡片配图与文档插图使用 —— 两套分工固定，不互相替代。'
        ),
        'stylePrefix': mod.STYLE_PREFIX,
        'categories': cats,
        'count': len(icons),
        'bitmapCount': len(with_bitmap),
        'icons': icons,
    })
    print('  %d 个图标 / %d 类 / %d 张位图已落盘 / 矢量 key 全部命中 tech-icons.ts'
          % (len(icons), len(cats), len(with_bitmap)))


def strip_java_comments(code):
    """剥掉 Java 注释，只留下会被编译的部分。

    为什么只按行首判断 // 和 *：URL 里的 https:// 中间也有 //，
    从行中间切会把它切碎。真正的注释一定以空白 + // 或 * 开头。
    """
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.S)
    return '\n'.join(l for l in code.split('\n')
                     if not re.match(r'^\s*(//|\*|/\*)', l))


def rule_ids():
    """扫描 arsenal-rules/**/*.json 里真实存在的规则 id。

    场景案例的 relatedRules 必须引用真实 id —— 猜的 id 会让「案例 ↔ 规则」
    这条反向链接在页面上一个字都显示不出来，而且不报错。
    """
    import glob as _glob
    ids = set()

    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get('id'), str) and o.get('severity'):
                ids.add(o['id'])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    for f in _glob.glob(os.path.join(ROOT, 'arsenal-rules', '**', '*.json'), recursive=True):
        try:
            with open(f, encoding='utf-8') as fh:
                walk(json.load(fh))
        except Exception as ex:
            print('  [warn] 规则文件读不动，跳过：%s (%s)' % (f, ex))
    return ids


def build_cases():
    """产出场景案例库。

    这里守的三条线，本质上都是同一个问题的不同侧面：**不许给出假的确定感**。
      · 切片没命中必须能说出原因（否则读者以为「不需要做」）
      · 锚点必须真的在代码里（否则备注会挂在错的地方，给出自信的错误结论）
      · 规则 id 必须真实存在（否则反向链接是空的）
    """
    print('[6/6] arsenal-cases —— 场景案例库')
    cases = []
    problems = []
    known_rules = rule_ids()

    def check_when(where, when, driver_levels):
        """when 只能引用已声明的 driver 与 level。拼错一个 id，条件就是恒假 ——
        切片永远不激活，页面上表现为「这个案例只有 3 个切片」，没人知道是拼错了。"""
        for did, levels in (when or {}).items():
            if did not in driver_levels:
                problems.append('%s 的 when 引用了未声明的 driver：%s' % (where, did))
                continue
            for lv in levels:
                if lv not in driver_levels[did]:
                    problems.append('%s 的 when 引用了 driver %s 未声明的档位：%s' % (where, did, lv))

    for name in CASES_MODULES:
        kase = load_module(name).CASE
        cid = kase.get('id', name)

        # ① 驱动参数：id 唯一、档位 id 唯一、至少 4 个驱动、每驱动至少 2 档
        driver_levels = {}
        # 档位的**声明顺序**。敏感度计算要用它做笛卡尔积 —— 用 set 会让产物随
        # PYTHONHASHSEED 漂移，同一份事实源两次构建产出不同 JSON。
        level_order = {}
        seen_driver = set()
        for d in kase.get('drivers') or []:
            if d['id'] in seen_driver:
                problems.append('%s 的 driver id 重复：%s' % (cid, d['id']))
            seen_driver.add(d['id'])
            lids = set()
            for lv in d.get('levels') or []:
                if lv['id'] in lids:
                    problems.append('%s/%s 的档位 id 重复：%s' % (cid, d['id'], lv['id']))
                lids.add(lv['id'])
            if len(lids) < 2:
                problems.append('%s/%s 只有 %d 个档位 —— 驱动参数必须离散且可选'
                                % (cid, d['id'], len(lids)))
            driver_levels[d['id']] = lids
            level_order[d['id']] = [lv['id'] for lv in d.get('levels') or []]
        if len(seen_driver) < 4:
            problems.append('%s 只有 %d 个驱动参数 —— 少于 4 个就退化成静态文案了'
                            % (cid, len(seen_driver)))

        # ② 切片：id 唯一、order 连续、when 合法、锚点命中、规则真实
        seen_slice = set()
        orders = []
        # 被 slices[].when 引用过的 driver —— ⑥ 判断「摆设参数」要用
        in_slice_when = set()
        for s in kase.get('slices') or []:
            where = '%s/%s' % (cid, s['id'])
            if s['id'] in seen_slice:
                problems.append('%s 的切片 id 重复' % where)
            seen_slice.add(s['id'])
            orders.append(s.get('order'))

            check_when(where, s.get('when'), driver_levels)
            in_slice_when.update((s.get('when') or {}).keys())

            code = s.get('code') or ''
            hl = s.get('highlights') or []
            if len(hl) < 2:
                problems.append('%s 只有 %d 条 highlights —— 少于 2 条说明这段代码没人真的读过'
                                % (where, len(hl)))
            seen_mark = set()
            for h in hl:
                mark = h.get('mark')
                if not mark:
                    problems.append('%s 有 highlight 缺少 mark 锚点' % where)
                    continue
                if mark in seen_mark:
                    problems.append('%s 的锚点重复：%s' % (where, mark[:40]))
                seen_mark.add(mark)
                if mark not in code:
                    problems.append('%s 锚点找不到目标：%s' % (where, mark[:60]))

            for r in s.get('relatedRules') or []:
                if r not in known_rules:
                    problems.append('%s 引用了不存在的规则 id：%s' % (where, r))

            if len(s.get('pitfalls') or []) < 2:
                problems.append('%s 的 pitfalls 少于 2 条' % where)
            if len(s.get('notSuitable') or []) < 2:
                problems.append('%s 的 notSuitable 少于 2 条' % where)
            if len(s.get('refs') or []) < 2:
                problems.append('%s 的 refs 少于 2 条 —— 无出处不收录' % where)
            # 反模式扫描：这几行出现在案例里等于在教人怎么写错。
            # 必须先剥注释 —— 「绝不要碰 ForkJoinPool.commonPool」这种正确的告诫
            # 会被当成示范，逼着人把话删掉，最后连警告都没了。
            for bad in ('newCachedThreadPool', 'ForkJoinPool.commonPool', 'TODO'):
                if bad in strip_java_comments(code):
                    problems.append('%s 的代码里出现了反模式/占位：%s' % (where, bad))

        if orders != list(range(1, len(orders) + 1)):
            problems.append('%s 的切片 order 不连续：%s' % (cid, orders))

        # ③ 矛盾与不适用：when 同样要合法
        in_conflict = set()
        in_not_suitable = set()
        for i, c in enumerate(kase.get('conflicts') or []):
            check_when('%s/conflict[%d]' % (cid, i), c.get('when'), driver_levels)
            in_conflict.update((c.get('when') or {}).keys())
            if not c.get('text'):
                problems.append('%s/conflict[%d] 没有说明矛盾在哪' % (cid, i))
        for i, n in enumerate(kase.get('notSuitableFor') or []):
            check_when('%s/notSuitableFor[%d]' % (cid, i), n.get('when'), driver_levels)
            in_not_suitable.update((n.get('when') or {}).keys())
            if not n.get('reason'):
                problems.append('%s/notSuitableFor[%d] 没有给出该看什么的理由' % (cid, i))

        # ④ 架构图节点只能来自场景数据，且连线两端必须都有节点
        arch = kase.get('architecture') or {}
        node_ids = [n['id'] for n in arch.get('nodes') or []]
        for ln in arch.get('links') or []:
            if ln['from'] not in node_ids or ln['to'] not in node_ids:
                problems.append('%s 的架构连线指向了不存在的节点：%s -> %s'
                                % (cid, ln['from'], ln['to']))
        for n in arch.get('nodes') or []:
            check_when('%s/arch/%s' % (cid, n['id']), n.get('whenAny'), driver_levels)

        # ⑤ 推荐档与症状入口：点进来必须有东西看
        #
        # 这条断言的存在理由：默认参数原本取每个驱动的第一档（最小档），
        # 而切片条件几乎都写在中高档 —— 落地场景 huge-rowcount-rdb 首屏命中 0/8，
        # 用户打开页面看到的只是「当前参数下没有任何切片命中」。
        # 「逻辑正确（小规模确实不需要这套方案）」挡不住「产品上是空屏」，
        # 所以推荐档必须由数据显式声明，并且在这里强制它真的有产出。
        def hit_count(params):
            return sum(1 for s in kase.get('slices') or []
                       if all((not lv) or params.get(did) in lv
                              for did, lv in (s.get('when') or {}).items()))

        rec = kase.get('recommended')
        if not rec:
            problems.append('%s 缺少 recommended —— 默认参数取最小档会让首屏命中 0 个切片' % cid)
            rec = {}
        else:
            for did, lv in rec.items():
                if did not in driver_levels:
                    problems.append('%s 的 recommended 引用了未声明的 driver：%s' % (cid, did))
                elif lv not in driver_levels[did]:
                    problems.append('%s 的 recommended 给了 driver %s 不存在的档位：%s' % (cid, did, lv))
            for d in kase.get('drivers') or []:
                if d['id'] not in rec:
                    problems.append('%s 的 recommended 缺少驱动 %s —— 缺省会让该维度静默落到第一档'
                                    % (cid, d['id']))
            if hit_count(rec) == 0:
                problems.append('%s 的 recommended 命中 0 个切片 —— 首屏会是空的' % cid)

        seen_sym = set()
        for i, sy in enumerate(kase.get('symptoms') or []):
            where = '%s/symptom[%d]' % (cid, i)
            if not isinstance(sy, dict) or not sy.get('text'):
                problems.append('%s 不是结构化症状 {id,text,params}' % where)
                continue
            sid = sy.get('id')
            if not sid:
                problems.append('%s 缺少 id' % where)
            elif sid in seen_sym:
                problems.append('%s 的症状 id 重复：%s' % (where, sid))
            seen_sym.add(sid)

            sym_params = sy.get('params') or {}
            for did, lv in sym_params.items():
                if did not in driver_levels:
                    problems.append('%s 的 params 引用了未声明的 driver：%s' % (where, did))
                elif lv not in driver_levels[did]:
                    problems.append('%s 的 params 给了 driver %s 不存在的档位：%s' % (where, did, lv))
            # 症状只声明它关心的维度，其余用推荐档补齐后再算命中 ——
            # 症状入口若通向空结果，用户会以为是自己描述得不对。
            if rec and hit_count({**rec, **sym_params}) == 0:
                problems.append('%s 点进去命中 0 个切片 —— 症状入口不能通向空结果' % where)

        # ⑥ 驱动参数不许是摆设，且「它到底能不能改变产出」必须算出来写进产物
        #
        # 存在理由：47 个驱动参数里实测有 11 个「拖到底，命中的切片一个都不变」。
        # 用户拖了半天滑块页面纹丝不动，只能得出一个结论 —— 这东西坏了。
        # 所以两条：
        #   ① 一个驱动至少要在 slices[].when / conflicts / notSuitableFor 里出现一次。
        #      三处都不引用的参数连提示都弹不出来，留着只是给页面凑数 —— 构建期直接拦掉。
        #   ② 把敏感度算出来写进 JSON，让前端照实标注「这个旋钮有多少用」，
        #      而不是让用户自己试出来。
        #
        # 敏感度的定义：固定其它驱动的每一组取值，把这个驱动依次切到每个档位，
        # 统计「命中切片集合发生变化」的档位对占比。0 = 纯摆设，1 = 每换一档结果都变。
        # ⚠️ 遍历的是「其它驱动的组合 × 本驱动档位对」，不是全部参数笛卡尔积 ——
        #    后者是 O(档位数 ^ 驱动数)，加一个驱动就翻几倍。
        slice_hits = [(s.get('id'), s.get('when') or {}) for s in kase.get('slices') or []]

        def active_ids(params):
            return frozenset(sid for sid, w in slice_hits
                             if all((not lv) or params.get(did) in lv
                                    for did, lv in w.items()))

        MAX_COMBOS = 20000
        new_drivers = []
        for d in kase.get('drivers') or []:
            did = d['id']
            if not (did in in_slice_when or did in in_conflict or did in in_not_suitable):
                problems.append(
                    '%s/%s 是摆设参数：slices[].when / conflicts / notSuitableFor 三处都不引用它 —— '
                    '用户拖动它不会有任何变化。补进告警条件，或从 drivers 里删掉' % (cid, did))

            others = [o for o in level_order if o != did]
            combos = list(itertools.product(*[level_order[o] for o in others]))
            total_combos = len(combos)
            stride = 1
            if total_combos > MAX_COMBOS:
                stride = (total_combos + MAX_COMBOS - 1) // MAX_COMBOS
                combos = combos[::stride]
                print('  ⚠ %s/%s 的对照组 %d 组超过上限 %d，按步长 %d 抽 %d 组（敏感度是估计值）'
                      % (cid, did, total_combos, MAX_COMBOS, stride, len(combos)))

            changed = 0
            pairs = 0
            for combo in combos:
                base = dict(zip(others, combo))
                seen_sets = []
                for lv in level_order[did]:
                    p = dict(base)
                    p[did] = lv
                    seen_sets.append(active_ids(p))
                for i in range(len(seen_sets)):
                    for j in range(i + 1, len(seen_sets)):
                        pairs += 1
                        if seen_sets[i] != seen_sets[j]:
                            changed += 1

            nd = dict(d)
            nd['sensitivity'] = round(changed / pairs, 3) if pairs else 0.0
            # inert 是给前端的承诺：这个参数不改变命中切片集合，只可能改变告警
            nd['inert'] = did not in in_slice_when
            new_drivers.append(nd)

        cases.append({
            **kase,
            'drivers': new_drivers,
            'sliceCount': len(kase.get('slices') or []),
            'driverCount': len(seen_driver),
            'ruleCount': len({r for s in kase.get('slices') or []
                              for r in s.get('relatedRules') or []}),
            'lines': sum(len((s.get('code') or '').split('\n'))
                         + len((s.get('sql') or '').split('\n'))
                         for s in kase.get('slices') or []),
        })

    if problems:
        print('\n[arsenal] 场景案例库数据校验失败：')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)

    cases.sort(key=lambda c: c['order'])
    ids = [c['id'] for c in cases]
    if len(set(ids)) != len(ids):
        sys.exit('[arsenal] 场景 id 重复：%s' % ids)

    for c in cases:
        write_json('arsenal-cases/%s.json' % c['id'], {'case': c})

    write_json('arsenal-cases/meta.json', {
        'collection': 'arsenal-cases',
        'name': '军火库 · 场景案例库',
        'version': '0.1.0',
        'releasedAt': '2026-09-22',
        'description': (
            '按问题与参数出方案。每个场景声明一组驱动参数（并发量 / 数据规模 / 读写比 / '
            '一致性 / P99 / 增长预期），每个代码切片带 when 条件：命中的给出建表 DDL 与生产级 Java，'
            '没命中的必须显式说明为什么在这个参数下不适用 —— 不许静默省略。'
            '与 arsenal-cookbook 的分工：cookbook 讲「一个功能标准该怎么写」，cases 讲「在这些约束下该怎么设计」。'
        ),
        'order': ids,
        'count': len(cases),
    })

    total_slices = sum(c['sliceCount'] for c in cases)
    total_lines = sum(c['lines'] for c in cases)
    total_drivers = sum(len(c['drivers']) for c in cases)
    inert_drivers = [(c['id'], d['id']) for c in cases for d in c['drivers'] if d.get('inert')]
    print('  %d 个场景 / %d 个切片 / %d 行代码 / 锚点与规则 id 全部命中'
          % (len(cases), total_slices, total_lines))
    print('  %d 个驱动参数：%d 个 inert（不改变命中切片，只影响告警），已在前端标注'
          % (total_drivers, len(inert_drivers)))


def _tech_icon_keys():
    """tech-icons.ts 里真实存在的矢量图标 key。

    与 build_icons 里同一套正则：只认两层缩进的顶层条目，
    否则会把 name/color/svg 这些字段也算成图标。
    """
    ts_path = os.path.join(ROOT, 'arsenal-web', 'src', 'lib', 'tech-icons.ts')
    if not os.path.exists(ts_path):
        return set(), '找不到 arsenal-web/src/lib/tech-icons.ts'
    with open(ts_path, encoding='utf-8') as f:
        src = f.read()
    keys = set()
    for m in re.finditer(r'^ {2}(\'([a-z0-9-]+)\'|([a-z0-9]+)): \{$', src, re.M):
        keys.add(m.group(2) or m.group(3))
    return keys, None


def build_scan():
    """产出代码扫描的技术栈映射表。

    这一层守的三件事，都是「静默失效」类：
      ① dim/opt 必须在 architecture.json 的画布选项里真存在 ——
         写错的后果不是报错，是扫描出来的技术栈**不画进架构图**，页面一片正常。
      ② icon 必须在 tech-icons.ts 里有一段图形 —— 否则节点落成灰方块。
      ③ 坐标不许重复 —— 同一条依赖命中两条规则，图上会出现两个节点。
    """
    print('[7/7] arsenal-scan —— 代码扫描映射表')
    mod = load_module('scan_rules')
    rules = mod.RULES
    problems = []

    icon_keys, icon_err = _tech_icon_keys()
    if icon_err:
        problems.append(icon_err)

    arch_path = os.path.join(ROOT, 'arsenal-stacks', 'architecture.json')
    dims, options = {}, {}
    if os.path.exists(arch_path):
        with open(arch_path, encoding='utf-8') as f:
            arch = json.load(f)
        canvas = arch.get('canvas') or {}
        dims = canvas.get('dims') or {}
        options = canvas.get('options') or {}
    else:
        problems.append('找不到 arsenal-stacks/architecture.json —— 无法校验 dim/opt')

    seen = {}
    for r in rules:
        at = '%s:%s' % (r.get('group'), r.get('artifact'))
        if r.get('kind') not in mod.KIND_LABEL:
            problems.append('%s 的 kind「%s」不合法' % (at, r.get('kind')))
        if not r.get('group') or not r.get('artifact'):
            problems.append('%s 缺少 group 或 artifact' % at)
        tech = r.get('tech') or ''
        if not re.match(r'^[a-z][a-z0-9-]*$', tech):
            problems.append('%s 的 tech「%s」不合法（小写字母开头）' % (at, tech))
        if not r.get('name'):
            problems.append('%s 没有中文名 —— 页面上只能显示坐标' % at)
        key = (r.get('kind'), r.get('group'), r.get('artifact'))
        if key in seen:
            problems.append('%s 重复登记（kind=%s）' % (at, r.get('kind')))
        seen[key] = True

        icon = r.get('icon')
        if icon and icon_keys and icon not in icon_keys:
            problems.append('%s 的 icon「%s」在 tech-icons.ts 里不存在' % (at, icon))

        dim, opt = r.get('dim'), r.get('opt')
        if dim and dim not in dims:
            problems.append('%s 的 dim「%s」不在架构画布的维度里' % (at, dim))
        elif dim and opt not in (options.get(dim) or {}):
            problems.append('%s 的 opt「%s」不在维度「%s」的选项里' % (at, opt, dim))
        if opt and not dim:
            problems.append('%s 只写了 opt 没写 dim —— 落不到架构图上' % at)

    if problems:
        print('\n[arsenal] 扫描映射表校验失败：')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)

    rows = sorted(rules, key=lambda r: (r.get('kind') or '', r.get('group') or '', r.get('artifact') or ''))
    on_canvas = len([r for r in rows if r.get('dim')])
    write_json('arsenal-scan/scan_rules.json', {
        'collection': 'arsenal-scan',
        'name': '军火库 · 代码扫描映射表',
        'version': '0.1.0',
        'description': (
            '依赖坐标 → 技术 key 的映射。扫描器只读坐标，不猜技术栈；'
            '命中的必须带 evidence（文件路径 + 行号），没命中的进 UNMAPPED_DEPENDENCY note —— '
            '不许静默丢弃。dim/opt 指向架构画布的真实维度与选项，命中即出现在部署图上；'
            '只有 tech 没有 dim 的表示「认得出来但不单独部署」（工具库 / 编码期依赖）。'
        ),
        'count': len(rows),
        'onCanvas': on_canvas,
        'kinds': mod.KIND_LABEL,
        'rules': rows,
    })
    print('  %d 条映射 / 其中 %d 条落架构图' % (len(rows), on_canvas))


def main():
    build_cookbook()
    build_stacks()
    build_architecture()
    build_project()
    build_icons()
    build_cases()
    build_scan()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
