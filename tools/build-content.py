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
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONTENT = os.path.join(HERE, 'content')


def load_module(name):
    path = os.path.join(CONTENT, name + '.py')
    spec = importlib.util.spec_from_file_location('c_' + name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write_json(rel_path, doc):
    full = os.path.join(ROOT, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    size = os.path.getsize(full)
    print('  %-44s %6.1f KB' % (rel_path, size / 1024))


def build_cookbook():
    print('[1/4] arsenal-cookbook —— 端到端功能范例')
    features = []
    for name in ('crud', 'http', 'async_tx', 'skeleton'):
        feat = load_module(name).FEATURE
        features.append(feat)
        write_json('arsenal-cookbook/%s.json' % feat['id'], {'feature': feat})

    write_json('arsenal-cookbook/meta.json', {
        'collection': 'arsenal-cookbook',
        'name': '军火库 · 蓝图库',
        'version': '0.1.0',
        'releasedAt': '2026-09-11',
        'description': (
            '一个功能「完整该怎么写」的示范。每个蓝图是一条端到端的垂直切片：'
            '从 HTTP 入口一路到 SQL，中间每一层都给出可复制的完整代码，'
            '并标注它对应军火库的哪几条规则。'
        ),
        'order': [f['id'] for f in features],
        'count': len(features),
    })


def build_stacks():
    print('[2/4] arsenal-stacks —— 技术选型')
    base = load_module('stack_base')
    dimensions = []
    for name in ('stack_base', 'stack_data', 'stack_mw', 'stack_cross'):
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
    if problems:
        print('\n[arsenal] 选型数据校验失败：')
        for p in problems:
            print('  - ' + p)
        sys.exit(1)

    stack = {
        'collection': 'arsenal-stacks',
        'name': '军火库 · 技术选型与架构装配',
        'version': '0.1.0',
        'releasedAt': '2026-09-11',
        'description': (
            '把一个 Spring Boot 项目拆成 17 个选型维度。勾选组合后，'
            '实时合成 pom 依赖、application.yml、必需的配置类与联动代码，'
            '并给出运维清单与冲突提示。'
        ),
        'groups': base.GROUPS,
        'dimensions': dimensions,
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
    for name in ('stack_base', 'stack_data', 'stack_mw', 'stack_cross'):
        dimensions.extend(load_module(name).DIMENSIONS)
    dim_ids = {d['id'] for d in dimensions}
    opt_ids = {d['id']: {o['id'] for o in d['options']} for d in dimensions}
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
            '把 17 个选型维度还原成一张可装配的架构图。每个零件声明它提供什么能力、'
            '需要什么能力，校验时求一次能力并集，就能算出这套组合能不能跑起来、缺的是哪一块。'
        ),
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
    for name in ('stack_base', 'stack_data', 'stack_mw', 'stack_cross'):
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
    known_readme = {'__SELECTION_TABLE__', '__TREE__', '__START__',
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


def main():
    build_cookbook()
    build_stacks()
    build_architecture()
    build_project()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
