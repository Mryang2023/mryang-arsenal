# -*- coding: utf-8 -*-
"""场景 7 · 多源文件入库与编号关联。

源自真实项目（医院基因检测数据管理系统）：3 类文件（FASTQ / VCF / Word 报告）、
6 家测序公司、文件以万计、命名规则各不相同，编号藏在文件夹名与文件名里。

这个场景的核心矛盾不是「数据量大」，而是**标识符异构**：
  ① 同一个病例的 VCF、FASTQ、报告散在不同机器、不同目录、不同命名规则下；
  ② 编号识别靠前缀正则，规则认不认识与库里有没有归属是两类独立失败；
  ③ 匹配不上的文件是台账素材，不是可以静默跳过的脏数据。

因此本场景的骨架是「规则引擎 + 四级匹配递进 + 异常台账」：
宁可 unmatched，不许猜一个关联。bad/good 素材（E7del 误识别、同前缀多病例、
假消失抖动、模板性空报告）全部来自真实项目的一轮全量扫描。
"""

DRIVERS = [
    {'id': 'scale', 'name': '数据规模', 'unit': '文件', 'hint': '三类文件合计',
     'levels': [
         {'id': 'f1w', 'label': '1 万', 'value': 10000},
         {'id': 'f5w', 'label': '5 万', 'value': 50000},
         {'id': 'f20w', 'label': '20 万', 'value': 200000},
         {'id': 'f100w', 'label': '100 万', 'value': 1000000},
     ]},
    {'id': 'idQuality', 'name': '编号规范化', 'unit': '', 'hint': '可被前缀规则识别的占比 —— 本场景真正的分水岭',
     'levels': [
         {'id': 'n99', 'label': '≥99%', 'note': '命名规则统一，主流格式占绝对多数'},
         {'id': 'n90', 'label': '约 90%', 'note': '有明确主流格式，少数特殊命名'},
         {'id': 'n70', 'label': '≤70%', 'note': '多来源混名，特殊格式占比高'},
     ]},
    {'id': 'scanMode', 'name': '扫描模式', 'unit': '', 'hint': '一次入库还是持续对账',
     'levels': [
         {'id': 'once', 'label': '一次性全量', 'note': '存量盘点，跑完即止'},
         {'id': 'periodic', 'label': '周期增量', 'note': '按天 / 按周重扫对账'},
         {'id': 'watch', 'label': '准实时监听', 'note': '目录变更事件驱动'},
     ]},
    {'id': 'parseDepth', 'name': '解析深度', 'unit': '', 'hint': '元数据 → 变异内容 → 报告内容',
     'levels': [
         {'id': 'meta', 'label': '只入元数据', 'note': '路径、类型、编号关联'},
         {'id': 'variant', 'label': '解析 VCF', 'note': '变异位点逐行入库'},
         {'id': 'full', 'label': 'VCF + 报告', 'note': '另含 Word 临床信息提取'},
     ]},
    {'id': 'queryQps', 'name': '检索并发', 'unit': '', 'hint': '内网检索为主',
     'levels': [
         {'id': 'solo', 'label': '单人', 'note': '生信分析员自用'},
         {'id': 'team', 'label': '≤10 人', 'note': '科室小团队'},
         {'id': 'service', 'label': '对外服务', 'note': '临床多科室检索'},
     ]},
    {'id': 'growth', 'name': '增长预期', 'unit': '', 'hint': '新增病例与文件的年度增速',
     'levels': [
         {'id': 'g1x', 'label': '年增 <1 倍'},
         {'id': 'g5x', 'label': '年增 5 倍'},
         {'id': 'g20x', 'label': '年增 20 倍'},
     ]},
]

CONFLICTS = [
    {'when': {'parseDepth': ['variant', 'full'], 'scanMode': ['once'], 'queryQps': ['team', 'service']},
     'text': '一次性全量解析数亿变异行 + 检索在线使用：导入会持续占用 IO 与索引维护资源，'
             '与在线查询直接冲突。把导入与查询分时段（夜里导入）或分实例（导入打备库），'
             '见切片「VCF 批量导入」与场景「基因 / DNA 序列海量存取」的同款冲突。'},
    {'when': {'idQuality': ['n70'], 'scanMode': ['once', 'periodic', 'watch']},
     'text': '编号可识别率低（≤70%）时自动建虚拟病例会把错误关联固化成数据：'
             '特殊命名里混着患者姓名、外显子写法、纯数字流水号，猜错一次就多一条假病例。'
             '必须先走人工确认队列（见切片「匹配率守卫与人工确认」），宁可 unmatched 也不许猜。'},
    {'when': {'scale': ['f20w', 'f100w'], 'scanMode': ['periodic'], 'queryQps': ['service']},
     'text': '周期增量扫描与对外检索争同一块盘：增量判变要全量比对 size + mtime，是顺序扫盘操作，'
             '与在线查询共享磁盘队列。扫描走只读副本或低峰窗口，且多副本任务必须用唯一键互斥，'
             '见切片「增量重扫」。'},
    {'when': {'growth': ['g5x', 'g20x'], 'parseDepth': ['variant', 'full']},
     'text': '年增 5 倍以上 + 逐行解析变异内容：变异位点的行数随病例数线性放大（一个 VCF 十几万行），'
             '增速 20 倍意味着三年后单表就是当下的 8000 倍，索引维护与备份窗口会先于磁盘容量崩掉。'
             '必须提前定好冷热分层与分区策略（见切片「VCF 批量导入」），'
             '并把「只入元数据 + 按需回解析」当成默认选项重新评估一遍。'},
]

NOT_SUITABLE_FOR = [
    {'when': {'scale': ['f1w'], 'parseDepth': ['meta']},
     'reason': '1 万个文件、只入库元数据：一把梭脚本就够。规则引擎、责任链、守卫报表在这里全是净成本。'
               '真正要做的只有三样：full_path 唯一键、size + mtime 判变、一张异常台账。'},
    {'when': {'idQuality': ['n99'], 'scanMode': ['once'], 'parseDepth': ['meta']},
     'reason': '编号规范 + 一次性扫描 + 不解析内容：人工确认队列、增量机制、守卫报表都不会激活。'
               '核心就是三样：正则规则表、一个幂等 upsert、一张台账。'},
]

BENCHMARK = {
    'title': '匹配策略与残留风险（真实项目口径：6 家公司 · 11,782 个 VCF 一轮全量扫描）',
    'columns': ['策略', 'matched 率', '残留风险', '适用前提'],
    'rows': [
        ['只做直接匹配（case_record）', '≈97%', '别名编号、报告夹命名缺公司编号的病例永久落空', '编号规范且来源单一'],
        ['+ 别名表 case_identifier', '≈99%', '同名不同人的编号冲突要人工甄别', '存在多编号并存的历史数据'],
        ['+ 交叉借用 + 虚拟病例', '99.4%（11,717 / 11,782）', '残留 unmatched 13、format_unknown 52 —— 全部显式留痕可查', 'VCF 与 FASTQ 可交叉印证'],
    ],
    'conclusion': '匹配率到 99% 之后，每一分提升的代价从「多写一条正则」变成「多建一条流程」——'
                  '人工确认队列与异常台账不是工程洁癖，是最后 1% 的唯一来源。'
                  '目标不是把数字做到 100%，而是剩下的 0.1% 每一条都有名字、有路径、有去向。',
}

ARCHITECTURE = {
    'nodes': [
        {'id': 'scanner', 'label': '扫描调度', 'kind': 'backend', 'tier': 0},
        {'id': 'rules', 'label': '编号规则引擎', 'kind': 'backend', 'tier': 0},
        {'id': 'ledger', 'label': '病例·文件台账', 'kind': 'database', 'tier': 1},
        {'id': 'variants', 'label': '变异位点库', 'kind': 'database', 'tier': 1,
         'whenAny': {'parseDepth': ['variant', 'full']}},
        {'id': 'docx', 'label': '报告解析', 'kind': 'backend', 'tier': 2,
         'whenAny': {'parseDepth': ['full']}},
        {'id': 'review', 'label': '人工确认队列', 'kind': 'messagebus', 'tier': 2,
         'whenAny': {'idQuality': ['n70', 'n90']}},
        {'id': 'issues', 'label': '异常台账', 'kind': 'security', 'tier': 2},
    ],
    'links': [
        {'from': 'scanner', 'to': 'rules', 'label': '文件名解析'},
        {'from': 'scanner', 'to': 'ledger', 'label': '元数据 upsert'},
        {'from': 'rules', 'to': 'ledger', 'label': '编号候选'},
        {'from': 'scanner', 'to': 'variants', 'label': 'VCF 批量导入'},
        {'from': 'scanner', 'to': 'docx', 'label': 'docx 解析'},
        {'from': 'docx', 'to': 'ledger', 'label': '临床信息回写'},
        {'from': 'rules', 'to': 'review', 'label': '候选送审'},
        {'from': 'review', 'to': 'ledger', 'label': '升级为别名'},
        {'from': 'scanner', 'to': 'issues', 'label': '异常留痕'},
    ],
}

SLICES = [
    {
        'id': 'folder-name-parser',
        'order': 1,
        'goal': '目录命名解析器：规则是数据，不是 if-else',
        'layer': '设计',
        'when': {},
        'why': '文件夹名与文件名是本场景唯一可靠的结构化信息来源。多分隔符切分 + 前缀编号'
               '规则表能覆盖 90% 以上的命名；剩下 5% 的特殊命名不是解析失败，是台账素材。',
        'decision': {
            'question': '编号规则怎么组织？',
            'options': [
                '每个公司一段 if-else —— 接入第 7 家公司就是一次改代码发版',
                '统一大正则一把梭 —— 某个族的位数约束一改，误伤所有族',
                '规则表（前缀族 + 正则 + 类型）+ 逐 token 前缀匹配 —— 新公司接入 = 插一行数据',
                '机器学习命名分类 —— 训练集比数据本身还难收集，错误不可解释',
            ],
            'chosen': '规则表 + 逐 token 前缀匹配。前缀族之间有包含关系的（MGNC / MGN）按长度降序注册',
            'tradeoff': '代价是规则之间有顺序语义（先长后短），靠注册顺序保证而不是引擎保证 —— '
                        '必须用一条测试钉死 MGNC 在 MGN 之前，否则截短误配静默发生。',
        },
        'sql': r"""-- 病例主表：只解析报告文件夹命名，不扫其中文件。文件夹名原样存，不做任何改写。
CREATE TABLE `case_record` (
  `id`                  BIGINT       NOT NULL AUTO_INCREMENT,
  `root_id`             BIGINT       NOT NULL COMMENT '扫描根，指向 storage_root',
  `folder_name`         VARCHAR(255) NOT NULL COMMENT '报告文件夹原始名，一切解析的原始证据',
  `folder_category`     VARCHAR(16)  NOT NULL DEFAULT 'normal' COMMENT 'normal / special / virtual',
  `hospital_case_code`  VARCHAR(32)  NULL COMMENT '第一个编号：永远是医院编号',
  `company_sample_code` VARCHAR(32)  NULL COMMENT '公司编号：按优先级判定，可能没有',
  `raw_description`     VARCHAR(255) NULL COMMENT '去掉编号后的剩余文字（姓名 / 结果等）',
  `create_time`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_folder` (`root_id`, `folder_name`),
  KEY `idx_hosp` (`hospital_case_code`),
  KEY `idx_comp` (`company_sample_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='病例主表 · 一个报告文件夹 = 一个病例';

-- 编号别名表：一个病例可能有多个编号（换版 / 家系 / 内外两套）。
-- 匹配第二级就查它；这里没有的编号，直接匹配才查得到。
CREATE TABLE `case_identifier` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `case_id`     BIGINT      NOT NULL,
  `id_type`     VARCHAR(16) NOT NULL COMMENT 'hospital / company / external',
  `id_value`    VARCHAR(32) NOT NULL,
  `source`      VARCHAR(16) NOT NULL COMMENT 'folder / fastq / vcf / manual',
  `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_type_value` (`id_type`, `id_value`),
  KEY `idx_case` (`case_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='编号别名 · 病例的多个称呼';""",
        'code': r"""/**
 * 场景：多源文件入库与编号关联 / 切片：目录命名解析器
 * 适用参数：所有参数组合（无条件切片）
 * 依赖规则：SEC-INPUT-001, SVC-EXCP-001, COL-CODE-003
 * JDK：17
 */
package com.example.inet.ingest;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 文件夹名 / 文件名 → 编号候选。
 *
 * 设计立场：规则是数据，不是分支。6 家公司 = 6 组规则记录，
 * 接入第 7 家时注册一条规则，解析器一行不改。
 * 散落的 if-else 是这类系统腐烂的开始 —— 每个分支看起来都一样，但都在偷偷不同。
 */
public final class CaseNameParser {

    /** 多分隔符切分：空格、下划线、中划线、逗号、顿号、分号、点。真实文件夹名什么都可能用。 */
    static final String TOKEN_SPLIT = "[\\s_\\-—,、;.;]+";

    /** 解析结果：医院编号与公司编号分开收集，各自保持出现顺序。 */
    public record Codes(List<String> hospitalCodes, List<String> companyCodes) {
    }

    /** 主编号判定。multiCase=true 表示同前缀双编号（夫妻 / 双胞胎文件夹），第二个编号绝不当公司编号。 */
    public record MainCode(String hospitalCode, String companyCode, boolean multiCase) {
    }

    /** 提取不出任何编号是业务事实，不是程序故障 —— 由上层统一记入异常台账。 */
    public static class UnrecognizedNameException extends RuntimeException {
        public UnrecognizedNameException(String message) {
            super(message);
        }
    }

    private final List<PrefixRule> rules = new ArrayList<>();

    /** 注册规则。顺序即优先级：MGNC 必须排在 MGN 之前，否则 MGNC 开头的编号会被截短误配。 */
    public void register(String family, String type, String regex) {
        rules.add(new PrefixRule(family, type, Pattern.compile(regex)));
    }

    /** 默认规则族。位数下限是踩坑成果：E 族要求至少 7 位数字，E7del 这类外显子写法不许被当成样本编号。 */
    public static CaseNameParser defaultRules() {
        CaseNameParser p = new CaseNameParser();
        p.register("C", "hospital", "^(\\d{2}C\\d{4,6})");
        p.register("W", "hospital", "^(\\d{2}W\\d{4})");
        p.register("P", "hospital", "^(\\d{2}P\\d{4})");
        p.register("SF", "hospital", "^(\\d{2}SF\\d{5})");
        p.register("E", "hospital", "^(E\\d{7,})");
        p.register("Y", "company", "^(\\d{2}Y\\d{5})");
        p.register("CS", "company", "^(\\d{2}CS\\d{5})");
        p.register("MGNC", "company", "^(MGNC\\d+)");
        p.register("MGN", "company", "^(MGN\\d+)");
        p.register("MS", "company", "^(MS\\d+)");
        p.register("LO", "company", "^(LO\\d+)");
        return p;
    }

    /**
     * 逐 token 前缀匹配。全部不带 $ 锚点 —— 编号后面经常紧跟中文
     * （「21P0079全外」），锚上 $ 这一整类命名会被整批漏掉，而且漏得很安静。
     */
    public Codes extract(String name) {
        Set<String> hospital = new LinkedHashSet<>();
        Set<String> company = new LinkedHashSet<>();
        for (String token : name.split(TOKEN_SPLIT)) {
            for (PrefixRule rule : rules) {
                String value = rule.extract(token);
                if (value == null) {
                    continue;
                }
                if ("hospital".equals(rule.type())) {
                    hospital.add(value);
                } else {
                    company.add(value);
                }
                break; // 一个 token 只归一个编号族，先命中先用
            }
        }
        return new Codes(List.copyOf(hospital), List.copyOf(company));
    }

    /**
     * 主编号判定，三条优先级一条都不能省：
     * ① 第一个编号永远是医院编号；
     * ② 公司编号优先取明确的公司前缀族；
     * ③ 两个编号同前缀 = 多病例文件夹（21W0020 + 21W0021），第二个编号不参与公司编号判定。
     */
    public MainCode resolve(Codes codes) {
        if (codes.hospitalCodes().isEmpty() && codes.companyCodes().isEmpty()) {
            throw new UnrecognizedNameException("未提取到任何编号，转入异常台账");
        }
        String hospital = codes.hospitalCodes().isEmpty() ? null : codes.hospitalCodes().get(0);
        String company = null;
        boolean multiCase = false;
        List<String> candidates = new ArrayList<>(codes.companyCodes());
        if (codes.hospitalCodes().size() > 1) {
            candidates.addAll(codes.hospitalCodes().subList(1, codes.hospitalCodes().size()));
        }
        for (String c : candidates) {
            if (hospital != null && prefixOf(hospital).equals(prefixOf(c))) {
                multiCase = true; // 同前缀：这是两个病例，不是一病例一公司
                continue;
            }
            if (company == null) {
                company = c;
            }
        }
        return new MainCode(hospital, company, multiCase);
    }

    /** 前缀 = 去掉数字部分：25CS02499 → CS，21W0020 → W。只用于同前缀判定。 */
    static String prefixOf(String code) {
        return code.replaceAll("\\d.*$", "");
    }

    private record PrefixRule(String family, String type, Pattern pattern) {
        String extract(String token) {
            Matcher m = pattern.matcher(token);
            return m.find() ? m.group(1) : null;
        }
    }
}
""",
        'highlights': [
            {'mark': 'static final String TOKEN_SPLIT = "[\\\\s_\\\\-—,、;.;]+";',
             'title': '多分隔符切分',
             'text': '真实文件夹名的分隔符不止下划线：空格、中划线、顿号都出现过。切不全的后果不是报错，'
                     '而是编号被切在半截，整条关联链静默断掉。',
             'rule': 'COL-CODE-003'},
            {'mark': 'p.register("E", "hospital", "^(E\\\\d{7,})");',
             'title': '位数下限是防误伤',
             'text': 'E 编号要求至少 7 位数字：E7del（外显子缺失写法）这类 token 不许被当成样本编号。'
                     '正则的宽严在医疗数据里是可信度问题，不是风格问题。',
             'rule': 'SEC-INPUT-001'},
            {'mark': 'if (hospital != null && prefixOf(hospital).equals(prefixOf(c))) {',
             'title': '同前缀 = 多病例文件夹',
             'text': '21W0020 + 21W0021：第二个编号是另一个病例。把它当公司编号存下去，两个真实病例'
                     '会被焊成一个，之后所有关联查询一起错，而且错得很安静。',
             'rule': 'SEC-INPUT-001'},
            {'mark': 'throw new UnrecognizedNameException("未提取到任何编号，转入异常台账");',
             'title': '解析不出也是一条数据',
             'text': '抛业务异常是为了把文件夹送进异常台账，而不是在循环里静默 continue。'
                     '特殊命名（约 5%）是台账素材，不是脏数据。',
             'rule': 'SVC-EXCP-001'},
        ],
        'pitfalls': [
            '把规则写成 if-else 长链 —— 新公司接入变成改代码发版，规则表本来是一行数据的事。',
            'MGNC 排在 MGN 之后 —— 前缀族有包含关系时顺序就是正确性，MGNC20230001 会被截短误配。',
            '正则带 $ 锚点 —— 「21P0079全外」这类编号后紧跟中文的命名整类漏掉，且无任何报错。',
            '同前缀双编号被当成「医院编号 + 公司编号」—— 两个真实病例在库里焊成一个，所有关联查询一起错。',
        ],
        'notSuitable': [
            '只有单一命名规则且无历史包袱：一张正则表加一个函数就够，规则引擎的抽象是提前优化。',
            '编号出现在固定分隔位置且可用 split 直接取：先确认稳定性再上引擎，不要为不存在的多样性设计。',
        ],
        'relatedRules': ['SEC-INPUT-001', 'SVC-EXCP-001', 'COL-CODE-003'],
        'refs': [
            {'title': '《阿里巴巴 Java 开发手册》· 命名与魔法值', 'note': '编号族白名单、分隔符常量的依据'},
            {'title': '省妇幼项目设计文档 · 五、正则规则全览', 'note': '11 条前缀规则与 E ≥ 7 位约束的真实来源'},
        ],
    },
    {
        'id': 'id-fallback-chain',
        'order': 2,
        'goal': '四级匹配递进：直接匹配 → 别名 → 交叉借用 → 虚拟病例',
        'layer': '设计',
        'when': {},
        'why': '文件与病例的关联从来不是一次查找：编号有别名、报告夹命名会缺公司编号、'
               '部分文件连报告夹都没有。递进链把「查不到」拆成四种显式结局，'
               '每种都有 match_status 可数、有台账可查 —— 宁可 unmatched，不许猜。',
        'decision': {
            'question': '查不到病例的文件怎么办？',
            'options': [
                '丢弃不入库 —— 库里「看起来全匹配上了」，实际丢了一沓',
                '猜一个最相似的病例 —— 错误关联固化成数据，比缺数据难清理一百倍',
                '全部 NULL 挂起 —— unmatched 和「规则不认识」混成一团，没人知道该改什么',
                '四级递进，每种结局显式落状态 —— 命中 / unmatched / format_unknown 全部可数',
            ],
            'chosen': '四级递进 + 显式状态。虚拟病例只建给「文件间能互认、但都没有归属」的编号组，'
                      '文件夹名明确标注（虚拟），检索端必须能区分',
            'tradeoff': '代价是链上每一级都要留命中层级（by），看板与排查都靠它；'
                        '收益是匹配率可以被拆解成「规则问题」和「数据问题」分别改进。',
        },
        'sql': r"""-- 文件资产表：所有来源的文件统一入这一张表。
-- case_id 为 NULL 是合法状态（未匹配），用占位 case_id 冒充「已关联」才是事故。
CREATE TABLE `file_asset` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT,
  `case_id`          BIGINT       NULL COMMENT 'NULL = 尚未关联到病例，是显式状态不是缺失',
  `root_id`          BIGINT       NOT NULL COMMENT '扫描根，指向 storage_root',
  `full_path`        VARCHAR(768) NOT NULL COMMENT '唯一业务键。UNC 路径归一化后入库（见切片「幂等入库」）',
  `file_type`        VARCHAR(16)  NOT NULL COMMENT 'fastq / vcf / report_docx',
  `identifier_type`  VARCHAR(16)  NULL COMMENT 'hospital / company',
  `identifier_value` VARCHAR(32)  NULL COMMENT '从文件名提取的编号',
  `member_suffix`    VARCHAR(8)   NULL COMMENT '成员后缀：H1 / W1 / FU0',
  `read_direction`   TINYINT      NULL COMMENT '1=R1 2=R2；NULL=非配对文件',
  `match_status`     VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'matched/unmatched/format_unknown',
  `parse_status`     VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'parsed/pending/failed',
  `size_bytes`       BIGINT       NOT NULL DEFAULT 0,
  `mtime`            BIGINT       NOT NULL DEFAULT 0 COMMENT 'epoch millis，增量判变的依据',
  `last_seen_at`     DATETIME(3)  NULL COMMENT '最近一次扫描见到它的时间',
  `create_time`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_full_path` (`full_path`),
  KEY `idx_case` (`case_id`),
  KEY `idx_ident` (`identifier_type`, `identifier_value`),
  KEY `idx_match` (`match_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件资产 · 三类文件统一台账';""",
        'code': r"""/**
 * 场景：多源文件入库与编号关联 / 切片：四级匹配递进
 * 适用参数：所有参数组合（无条件切片）
 * 依赖规则：SVC-LAYR-001, SVC-LAYR-002, REL-EXCP-001, SVC-EXCP-001
 * JDK：17
 */
package com.example.inet.ingest;

import java.util.List;
import java.util.Optional;

/**
 * 四级匹配递进：直接匹配 → 别名表 → 交叉借用 → 虚拟病例。
 *
 * 每一级的产出只有三种：命中（带 case_id）、交棒（pass）、无法解析（format_unknown）。
 * 四级全部交棒得到的 unmatched 是一个结论，不是缺失值 ——
 * 它必须落 match_status、进台账、在看板上被数出来。
 * 任何一级都不许「猜一个 case_id」：把错误关联固化成数据，比缺数据难清理一百倍。
 */
public final class MatchChain {

    /** 待匹配文件的最小投影：编号提取产物 + 文件自身标识。 */
    public record Candidate(long fileId, String identifierType, String identifierValue) {
    }

    /** 匹配结果。by 记录命中层级，看板与排查都靠它分辨「命在哪一级」。 */
    public record Outcome(String status, Long caseId, String by) {
        public static Outcome matched(long caseId, String by) {
            return new Outcome("matched", caseId, by);
        }

        public static Outcome pass() {
            return new Outcome("pass", null, null);
        }

        public static Outcome unknown() {
            return new Outcome("format_unknown", null, null);
        }
    }

    public interface Node {
        Outcome handle(Candidate file);
    }

    private final List<Node> chain;

    public MatchChain(List<Node> chain) {
        this.chain = List.copyOf(chain);
    }

    public Outcome resolve(Candidate file) {
        if (file.identifierValue() == null || file.identifierValue().isBlank()) {
            return Outcome.unknown();
        }
        for (Node node : chain) {
            Outcome o = node.handle(file);
            if (!"pass".equals(o.status())) {
                return o; // 命中即停：后面的层级不再碰这个文件
            }
        }
        return new Outcome("unmatched", null, "chain-exhausted");
    }

    /** 级 3：交叉借用。本文件查不到病例，但同编号的其他文件已经有归属 —— 借用，不新建。 */
    static final class CrossBorrowNode implements Node {
        private final FileAssetDao fileAssets;

        CrossBorrowNode(FileAssetDao fileAssets) {
            this.fileAssets = fileAssets;
        }

        @Override
        public Outcome handle(Candidate file) {
            Optional<Long> peerCase = fileAssets.findMatchedCaseId(file.identifierValue());
            return peerCase.map(id -> Outcome.matched(id, "cross-borrow"))
                    .orElseGet(Outcome::pass);
        }
    }

    /**
     * 级 4：虚拟病例。VCF 与 FASTQ 能通过编号互认，但都没有归属 ——
     * 建一个显式的 special 病例把它们收留。名称标注「（虚拟）」，
     * 检索端必须能一眼区分虚拟与真实，绝不冒充。
     */
    static final class VirtualCaseNode implements Node {
        private final CaseRecordDao cases;
        private final FileAssetDao fileAssets;

        VirtualCaseNode(CaseRecordDao cases, FileAssetDao fileAssets) {
            this.cases = cases;
            this.fileAssets = fileAssets;
        }

        @Override
        public Outcome handle(Candidate file) {
            if (!fileAssets.hasUnmatchedPeer(file.identifierValue())) {
                return Outcome.pass();
            }
            long virtualId = cases.createVirtual(file.identifierValue());
            fileAssets.reassignIdentifier(file.identifierValue(), virtualId);
            return Outcome.matched(virtualId, "virtual-case");
        }
    }

    public interface FileAssetDao {
        Optional<Long> findMatchedCaseId(String identifierValue);

        boolean hasUnmatchedPeer(String identifierValue);

        void reassignIdentifier(String identifierValue, long caseId);
    }

    public interface CaseRecordDao {
        long createVirtual(String baseCode);
    }
}
""",
        'highlights': [
            {'mark': 'return new Outcome("unmatched", null, "chain-exhausted");',
             'title': 'unmatched 是结论，不是缺失',
             'text': '四级全部交棒后返回的 unmatched 必须落 match_status、进台账。'
                     '它是一个可以在看板上被数出来的状态 —— 「看起来全匹配上了」才是最大的事故。',
             'rule': 'REL-EXCP-001'},
            {'mark': 'if (!"pass".equals(o.status())) {',
             'title': '命中即停',
             'text': '某一层命中后，后面的层级不再碰这个文件。顺序错了（先虚拟后交叉），'
                     '本可借用的真实关联会被抢先建出来的虚拟病例覆盖。',
             'rule': 'SVC-LAYR-002'},
            {'mark': 'return peerCase.map(id -> Outcome.matched(id, "cross-borrow"))',
             'title': '借用，不新建',
             'text': '同编号的 FASTQ 已经有归属时，VCF 借用它的 case_id。'
                     '新建会造成「同一个病例在库里有两个 id」，聚合统计当场翻倍。',
             'rule': 'SVC-LAYR-002'},
            {'mark': 'long virtualId = cases.createVirtual(file.identifierValue());',
             'title': '虚拟病例显式建档',
             'text': 'VCF 与 FASTQ 能互认、但都没有归属时，建 special 病例收留它们。'
                     '名称标注（虚拟）、类型落 folder_category，检索端必须能区分 —— 不许冒充真实病例。',
             'rule': 'SVC-EXCP-001'},
        ],
        'pitfalls': [
            '拿「编号前缀相似」当命中依据 —— 前缀匹配只用于提取，关联必须全串相等，相似就是猜。',
            '虚拟病例与真实病例共用查询入口不做区分 —— 临床人员会把虚拟病例当真实依据。',
            '递进顺序写错（先虚拟后交叉）—— 本可借用的真实关联被虚拟病例抢先覆盖。',
            'unmatched 只把 case_id 置 NULL、不落 match_status —— 看板上永远「都匹配上了」。',
        ],
        'notSuitable': [
            '只有一种文件来源且编号即主键：不存在递进，直接主键查找即可。',
            '所有编号都能在 case_record 直接命中（历史数据已清洗）：别名与交叉借用是死代码，删掉比留着诚实。',
        ],
        'relatedRules': ['SVC-LAYR-001', 'SVC-LAYR-002', 'REL-EXCP-001', 'SVC-EXCP-001'],
        'refs': [
            {'title': 'MySQL 8.0 Manual · 约束与 NULL 语义',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/constraints.html',
             'note': 'case_id 可空 + match_status 列组合是「显式未匹配」的落点'},
            {'title': '省妇幼项目 · 阶段4a 递进策略实测',
             'note': '11,782 个 VCF：三级共命中 11,717，残留 unmatched 13、format_unknown 52，全部显式可查'},
        ],
    },
    {
        'id': 'idempotent-upsert',
        'order': 3,
        'goal': '幂等入库：扫描一百遍，库里只有一条',
        'layer': '数据访问',
        'when': {},
        'why': '扫描注定会重跑（规则升级、机器重启、人工补扫）。防重的锚只有'
               'full_path 唯一键 + size/mtime 判变，任何「我觉得它该是新的」都是重复数据的来源。',
        'decision': {
            'question': '重扫时同一路径的文件怎么处理？',
            'options': [
                '先 DELETE 全表再全量插入 —— 简单粗暴，但台账、病例关联全部断链',
                '不管，插完靠 GROUP BY 去重查 —— 存储翻倍，统计口径永久失真',
                'full_path 唯一键 + size/mtime 判变 —— 新增 / 更新 / 未变 / 消失四态分明',
                '内容哈希判重 —— 最严谨，但几万文件的哈希计算让扫描时间翻数倍',
            ],
            'chosen': 'full_path 归一化后做唯一键，size + mtime 判变。last_seen_at 只由「本轮见过」推动',
            'tradeoff': '代价是路径归一化规则必须全链路一致（UNC 大小写、正反斜杠、结尾分隔符），'
                        '一处不一致唯一键就是筛子；收益是扫描可以任意重入，消失检测有依据。',
        },
        'sql': r"""-- 扫描根登记：换服务器只改 root_path，下游数据不动。
-- 停用置 enabled=0，禁止 DELETE —— 病例仍需回溯数据来源。
CREATE TABLE `storage_root` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `root_path`   VARCHAR(512) NOT NULL COMMENT 'UNC 或挂载路径，归一化后入库',
  `root_type`   VARCHAR(16)  NOT NULL DEFAULT 'report' COMMENT 'report / fastq / vcf / virtual',
  `enabled`     TINYINT      NOT NULL DEFAULT 1,
  `create_time` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_root_path` (`root_path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='扫描根登记 · 换服务器只改这一行';

-- 每轮扫描一条：既是统计入口，也是增量判变的时间基准，更是多副本互斥的锚。
CREATE TABLE `scan_job` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `root_id`     BIGINT      NOT NULL,
  `started_at`  DATETIME(3) NOT NULL,
  `finished_at` DATETIME(3) NULL,
  `scanned`     INT         NOT NULL DEFAULT 0,
  `inserted`    INT         NOT NULL DEFAULT 0,
  `updated`     INT         NOT NULL DEFAULT 0,
  `missing`     INT         NOT NULL DEFAULT 0 COMMENT '本轮未见到（疑似已删除）的文件数',
  `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_root_started` (`root_id`, `started_at`)
    COMMENT '同一根同一时刻只允许一轮：起扫先 INSERT，撞唯一键的副本直接退出'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='扫描任务台账';""",
        'code': r"""/**
 * 场景：多源文件入库与编号关联 / 切片：幂等入库
 * 适用参数：所有参数组合（无条件切片）
 * 依赖规则：DATA-SQL-001, DATA-SQL-004, DATA-SCHM-003
 * JDK：17
 */
package com.example.inet.ingest;

import java.util.Locale;

/**
 * 幂等入库：扫描可以跑一百遍，库里只有一条。
 *
 * 判定只看三样东西：full_path（是不是同一个文件）、size_bytes、mtime（变没变）。
 * 其余一切都不可靠 —— 文件名相同内容可以不同，路径大小写不同其实是同一个。
 */
public final class FileAssetAbsorber {

    private final FileAssetDao dao;
    private final ScanStats stats;

    public FileAssetAbsorber(FileAssetDao dao, ScanStats stats) {
        this.dao = dao;
        this.stats = stats;
    }

    /** 路径归一化：UNC 大小写、正反斜杠、结尾分隔符。不归一，唯一键就是筛子。 */
    static String normalizePath(String raw) {
        String p = raw.replace('\\', '/').toLowerCase(Locale.ROOT);
        return p.endsWith("/") ? p.substring(0, p.length() - 1) : p;
    }

    public void absorb(ScannedFile f) {
        String path = normalizePath(f.fullPath());
        Existing row = dao.findByFullPath(path);
        if (row == null) {
            try {
                dao.insert(f.withFullPath(path));
                stats.inserted();
            } catch (DuplicateKeyException e) {
                // 并发扫描撞唯一键：按已存在处理。这不是错误，是幂等的兜底。
                stats.skipped();
            }
            return;
        }
        boolean changed = row.sizeBytes() != f.sizeBytes() || row.mtime() != f.mtime();
        if (changed) {
            dao.updateMeta(row.id(), f);
            stats.updated();
        } else {
            dao.touch(row.id()); // 只推 last_seen_at：它是「本轮扫描见过它」的唯一凭证
            stats.unchanged();
        }
    }

    public record ScannedFile(long rootId, String fullPath, String fileType,
                              long sizeBytes, long mtime) {
        ScannedFile withFullPath(String p) {
            return new ScannedFile(rootId, p, fileType, sizeBytes, mtime);
        }
    }

    public record Existing(long id, long sizeBytes, long mtime) {
    }

    /** 模拟唯一键冲突。真实实现里由 JDBC 驱动把 MySQL 的 duplicate key 包装成它。 */
    static class DuplicateKeyException extends RuntimeException {
    }

    public interface FileAssetDao {
        Existing findByFullPath(String normalizedPath);

        void insert(ScannedFile f);

        void updateMeta(long id, ScannedFile f);

        void touch(long id);
    }

    public interface ScanStats {
        void inserted();

        void updated();

        void unchanged();

        void skipped();
    }
}
""",
        'highlights': [
            {'mark': "String p = raw.replace('\\\\', '/').toLowerCase(Locale.ROOT);",
             'title': '路径归一化是防重的前提',
             'text': 'UNC 大小写、映射盘符、正反斜杠、结尾分隔符，任何一个不同都会让同一文件变成两条记录。'
                     '归一化规则必须全链路一致，否则唯一键形同虚设。',
             'rule': 'DATA-SQL-004'},
            {'mark': 'catch (DuplicateKeyException e) {',
             'title': '撞唯一键是兜底，不是错误',
             'text': '并发扫描同一文件时，数据库唯一键是最后的防线。捕获后按已存在处理，'
                     '绝不能让一条重复中断整轮几万文件的扫描。',
             'rule': 'DATA-SQL-004'},
            {'mark': 'boolean changed = row.sizeBytes() != f.sizeBytes() || row.mtime() != f.mtime();',
             'title': '判变只信 size + mtime',
             'text': '文件名相同内容可以不同。判变标准一旦引入猜测（比如「路径没变就是没变」），'
                     '增量扫描就会漏更新。',
             'rule': 'DATA-SQL-004'},
            {'mark': 'dao.touch(row.id());',
             'title': 'last_seen_at 是唯一凭证',
             'text': '「本轮扫描见过它」只由 touch 记录。它同时是消失检测的判据 —— '
                     '不更新它，下一轮消失检测会把活文件误判成已删除。',
             'rule': 'DATA-SQL-001'},
        ],
        'pitfalls': [
            '路径不归一化就做唯一键 —— 大小写、盘符、斜杠任一不同，同一文件两条记录，防重形同虚设。',
            '扫描漏了 touch —— last_seen_at 不更新，消失检测把活文件当已删除。',
            '并发扫描没有唯一键兜底，撞重直接抛错中断整轮 —— 一条重复让几万个文件半途而废。',
            'update_meta 顺手覆盖 match_status / parse_status —— 元数据与解析状态是两条线，混写会把已解析标记回 pending。',
        ],
        'notSuitable': [
            '文件只在生成时写一次、永不改动、且只扫一遍：判变逻辑没有对象，插入即可。',
            '存储端已有成熟清单/事件通知：轮询比对是下位替代，别在事件源上再手搓一套。',
        ],
        'relatedRules': ['DATA-SQL-001', 'DATA-SQL-004', 'DATA-SCHM-003'],
        'refs': [
            {'title': 'Google SRE · Data Integrity',
             'url': 'https://sre.google/sre-book/data-integrity/',
             'note': '对账与幂等是批量管道的底线'},
            {'title': 'MySQL 8.0 · INSERT ... ON DUPLICATE KEY UPDATE',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/insert-on-duplicate.html',
             'note': '撞唯一键后按已存在处理还是覆盖更新，必须显式选'},
        ],
    },
    {
        'id': 'issue-ledger',
        'order': 4,
        'goal': '异常台账：每一类失败都有名字，每一次失败都留痕',
        'layer': '运维',
        'when': {},
        'why': '匹配率永远到不了 100%（真实项目一轮扫描 11,782 个 VCF 里有 52 个 format_unknown）。'
               '「为什么不是 100%」的唯一答案来源就是台账 —— 没有它，丢掉的文件连被讨论的资格都没有。',
        'decision': {
            'question': '扫描中的异常怎么处理？',
            'options': [
                '打印后继续 —— 日志一滚就没了，匹配率掉 1% 都查不出丢在哪',
                '抛出去中断整轮 —— 一个文件的异常绑架几万个文件',
                '台账 + 日志双轨 —— 不抛出（扫描是长跑），但每类失败有名字、每条失败有现场',
                '自动重试直到成功 —— 网络抖动重试合理，格式问题重试一万次也不会好',
            ],
            'chosen': '台账 + 日志双轨。每类异常一个显式类型常量，failed 只给「下一轮可能变好」的问题，'
                      '格式问题记台账等人工或规则升级',
            'tradeoff': '代价是台账表会持续增长，需要定期人工消化（is_resolved 标记而非删除）；'
                        '收益是「数据可信」从口号变成可审计的事实链。',
        },
        'sql': r"""-- 异常台账。它是「匹配率为什么不是 100%」的唯一答案来源。只增不删，人工消化用 is_resolved。
CREATE TABLE `file_issue` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `file_id`      BIGINT       NULL COMMENT '文件维度异常才填；文件夹命名异常为 NULL',
  `folder_name`  VARCHAR(255) NULL COMMENT '原始名进受控表可以，进日志不行（含患者姓名）',
  `issue_type`   VARCHAR(32)  NOT NULL COMMENT 'folder_format_unknown / missing_r1 / file_deleted / ...',
  `detail`       VARCHAR(512) NULL,
  `is_resolved`  TINYINT      NOT NULL DEFAULT 0 COMMENT '人工处理完置 1，历史行永不修改',
  `resolved_by`  VARCHAR(32)  NULL,
  `create_time`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_type_resolved` (`issue_type`, `is_resolved`),
  KEY `idx_file` (`file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='异常台账 · 每一类失败都有名字';""",
        'code': r"""/**
 * 场景：多源文件入库与编号关联 / 切片：异常台账
 * 适用参数：所有参数组合（无条件切片）
 * 依赖规则：REL-EXCP-001, REL-LOG-002, REL-LOG-003, SEC-LOG-001
 * JDK：17
 */
package com.example.inet.ingest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 异常台账：每一类失败都要有名字，每一次失败都要留下痕迹。
 *
 * 扫描是长跑：一个文件的异常不该打断几万个文件的旅程（不向上抛），
 * 但「不抛出」绝不等于「不记录」—— 台账 + 日志两样都齐，才不算吞异常。
 */
public final class IssueRecorder {

    private static final Logger log = LoggerFactory.getLogger(IssueRecorder.class);

    /** 异常类型常量。散落的魔法串会让「按类型统计」变成一场字符串考古。 */
    public static final String FOLDER_FORMAT_UNKNOWN = "folder_format_unknown";
    public static final String EMPTY_FILE = "empty_file";
    public static final String MISSING_R1 = "missing_r1";
    public static final String MISSING_R2 = "missing_r2";
    public static final String FILE_DELETED = "file_deleted";
    public static final String VCF_PARSE_ERROR = "vcf_parse_error";
    public static final String REPORT_PARSE_ERROR = "report_parse_error";
    public static final String REPORT_EMPTY_CLINICAL = "report_empty_clinical";

    private final IssueDao dao;

    public IssueRecorder(IssueDao dao) {
        this.dao = dao;
    }

    /**
     * 台账写入永不向上抛。台账自身写失败时降级为 error 日志 ——
     * 宁可日志里多一条，也不能让一个文件的异常打断整轮扫描。
     */
    public void record(String issueType, Long fileId, String fullPath, String detail) {
        // 完整路径含患者姓名：只进受控台账表，日志里绝不出现 —— SEC-LOG-001 的现场应用。
        log.warn("扫描异常 type={} fileId={} detail={}", issueType, fileId, detail);
        try {
            dao.insert(issueType, fileId, fullPath, detail);
        } catch (RuntimeException e) {
            log.error("异常台账写入失败 type={} fileId={}", issueType, fileId, e);
        }
    }

    public interface IssueDao {
        void insert(String issueType, Long fileId, String fullPath, String detail);
    }
}
""",
        'highlights': [
            {'mark': 'public static final String REPORT_PARSE_ERROR = "report_parse_error";',
             'title': '每类失败都有名字',
             'text': '异常类型是封闭集合（8 类），用常量而不是现场拼串。'
                     '「按类型统计匹配率」这个动作能成立，前提就是类型不漂移。',
             'rule': 'REL-EXCP-001'},
            {'mark': 'log.warn("扫描异常 type={} fileId={} detail={}", issueType, fileId, detail);',
             'title': '留痕但不泄密',
             'text': '占位符日志 + 只打类型与文件 id，完整路径（含患者姓名）只进受控台账表。'
                     '排查方便和敏感数据合规在这里必须同时成立。',
             'rule': 'REL-LOG-002'},
            {'mark': 'log.error("异常台账写入失败 type={} fileId={}", issueType, fileId, e);',
             'title': '台账自身失败也要可见',
             'text': '台账写失败降级为 error 日志而不是抛出 —— 保住整轮扫描，'
                     '但绝不静默：丢一条台账记录也是丢证据。',
             'rule': 'REL-LOG-003'},
            {'mark': 'public void record(String issueType, Long fileId, String fullPath, String detail) {',
             'title': '永不向上抛',
             'text': '一个文件的异常不该绑架几万个文件的旅程。异常的去向是台账，'
                     '不是中断 —— 中断的合法性由调用方（整轮级别的守卫）决定。',
             'rule': 'REL-EXCP-001'},
        ],
        'pitfalls': [
            'catch 里只 printStackTrace 然后继续 —— 没有台账，匹配率掉 1% 都查不出丢在哪。',
            '把 full_path 原样打进日志 —— 路径里有患者姓名，敏感信息泄漏就是从「方便排查」开始的。',
            '异常类型用魔法串到处现场拼 —— folder_format_unknown 和 folderformatunknown 在统计里是两类。',
            '台账允许编辑删除 —— 台账的价值在不可变性，人工处理用 is_resolved 标记，历史行永不改。',
        ],
        'notSuitable': [
            '任务是一次性脚本且跑完即弃：台账落库可以退化为结构化输出文件，但「有记录」不可妥协。',
            '异常已由上游批处理框架统一记录（如 skip listener）：别重复记两份，接同一张表即可。',
        ],
        'relatedRules': ['REL-EXCP-001', 'REL-LOG-002', 'REL-LOG-003', 'SEC-LOG-001'],
        'refs': [
            {'title': 'SLF4J · Manual', 'url': 'https://www.slf4j.org/manual.html',
             'note': '门面与占位符'},
            {'title': '《阿里巴巴 Java 开发手册》· 异常与日志',
             'note': '空 catch、printStackTrace、日志占位符三条红线的出处'},
        ],
    },
    {
        'id': 'incremental-rescan',
        'order': 5,
        'goal': '增量重扫：变化的判定只信 size+mtime，消失的判定只信 last_seen_at',
        'layer': '数据访问',
        'when': {'scanMode': ['periodic', 'watch']},
        'why': '周期扫描的难点不是「扫出新文件」，而是三个容易被写错的判定：'
               '谁变了、谁消失了、谁的旧失败结论该作废。每一个都需要显式判据，不能靠感觉。',
        'decision': {
            'question': '「文件消失」怎么判定？',
            'options': [
                '扫不到就直接删行 —— 网络盘抖动会造成整批假消失，删错就真没了',
                '永远不删，只标记 —— 台账里堆积已删除记录，但数据绝不误伤',
                '连续 N 轮扫不到才删 —— 介乎两者，N 是新的魔法数',
                '标记 + 台账，人工确认后归档 —— 数据不丢，决策留给人',
            ],
            'chosen': '标记 file_deleted 进台账，不删行。消失检测的判据只有一个：last_seen_at 落后于本轮开始时间',
            'tradeoff': '代价是表里会留着已删除文件的行（is_resolved 消化）；'
                        '收益是共享盘挂载抖动造成的整批「假消失」永远不会变成真删除。',
        },
        'sql': r"""-- 增量重扫的两个核心查询：疑似消失 / 配对完整性。都必须命中索引，禁止全表扫。

-- ① 疑似消失：last_seen_at 落后于本轮扫描开始时间的启用根下文件。
--    查出来只记台账，不删行 —— 网络盘抖动会造成整批「假消失」。
SELECT f.id, f.full_path
FROM file_asset f
JOIN storage_root r ON r.id = f.root_id AND r.enabled = 1
WHERE f.last_seen_at < :scanStartedAt
ORDER BY f.id
LIMIT 2000;

-- ② R1/R2 配对完整性：同一 case 同一编号只找到一个方向 ——
--    缺 R1 或 R2 比两份都丢更危险：单端数据当双端跑比对，产出的是错误结论而不是报错。
SELECT f.case_id, f.identifier_value,
       COUNT(DISTINCT f.read_direction) AS sides
FROM file_asset f
WHERE f.file_type = 'fastq'
  AND f.read_direction IS NOT NULL
  AND f.case_id IS NOT NULL
GROUP BY f.case_id, f.identifier_value
HAVING COUNT(DISTINCT f.read_direction) < 2;""",
        'code': r"""/**
 * 场景：多源文件入库与编号关联 / 切片：增量重扫
 * 适用参数：扫描模式 = 周期增量 / 准实时监听
 * 依赖规则：REL-CTNR-004, REL-RETRY-001, CONC-POOL-004
 * JDK：17
 */
package com.example.inet.ingest;

import java.time.Instant;
import java.util.List;

/**
 * 增量重扫：变化的判定只信 size + mtime，消失的判定只信 last_seen_at，
 * 重试的判定只信 match_status。不引入任何「我觉得它应该变了」的猜测。
 */
public final class RescanPlanner {

    private final FileAssetDao fileAssets;
    private final IssueRecorder issues;

    public RescanPlanner(FileAssetDao fileAssets, IssueRecorder issues) {
        this.fileAssets = fileAssets;
        this.issues = issues;
    }

    /**
     * 消失检测：一轮收尾时，last_seen_at 还停在上一轮的文件就是疑似删除。
     * 记台账而不是删行 —— 共享盘挂载抖动会造成整批「假消失」，
     * 删错一批真文件，比台账里多几条已删除记录难收拾得多。
     */
    public void detectMissing(Instant scanStartedAt) {
        List<MissingFile> missing = fileAssets.findMissingSince(scanStartedAt);
        for (MissingFile m : missing) {
            issues.record(IssueRecorder.FILE_DELETED, m.fileId(), m.fullPath(), "本轮扫描未见");
        }
    }

    /**
     * 配对完整性：FASTQ 缺 R1 或 R2 比两份都丢更危险 ——
     * 拿单端数据当双端跑比对，产出的是错误结论而不是报错。
     */
    public void detectBrokenPairs() {
        List<BrokenPair> pairs = fileAssets.findBrokenPairs();
        for (BrokenPair p : pairs) {
            issues.record(IssueRecorder.MISSING_R1, p.fileId(), p.identifierValue(),
                    "base_code=" + p.identifierValue() + " 只找到 " + p.sides() + " 个读方向");
        }
    }

    /**
     * 规则升级后的重试：只重置 format_unknown，绝不动 parsed。
     * 已解析的记录被重置，等于把算过的亿级位点再算一遍。
     */
    public int requeueUnknown() {
        // 重试必须可数：返回值会出现在下一轮扫描报告里，不许「悄悄重试」。
        return fileAssets.resetUnknownToPending();
    }

    public record MissingFile(long fileId, String fullPath) {
    }

    public record BrokenPair(long fileId, String identifierValue, int sides) {
    }

    public interface FileAssetDao {
        List<MissingFile> findMissingSince(Instant scanStartedAt);

        List<BrokenPair> findBrokenPairs();

        int resetUnknownToPending();
    }
}
""",
        'highlights': [
            {'mark': 'List<MissingFile> missing = fileAssets.findMissingSince(scanStartedAt);',
             'title': '消失判定只信 last_seen_at',
             'text': '判据必须是一个可以指认的字段。「目录打不开就算全删了」的猜测，'
                     '在共享盘抖动的那天会删掉整个库。',
             'rule': 'REL-CTNR-004'},
            {'mark': 'issues.record(IssueRecorder.FILE_DELETED, m.fileId(), m.fullPath(), "本轮扫描未见");',
             'title': '假消失记台账，不删行',
             'text': '挂载抖动、权限变更、网络分区都会造成「暂时扫不到」。'
                     '删行是不可逆操作，把它留给人或下一轮对账。',
             'rule': 'REL-CTNR-004'},
            {'mark': 'issues.record(IssueRecorder.MISSING_R1, p.fileId(), p.identifierValue(),',
             'title': '配对不完整比都丢更危险',
             'text': '单端数据当双端跑比对，产出的是错误结论而不是报错。'
                     '这类问题必须主动检测，等分析员发现就晚了。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'return fileAssets.resetUnknownToPending();',
             'title': '重试可数、有边界',
             'text': '只重置 format_unknown（规则升级后可能变好），返回值进扫描报告。'
                     'parsed 的记录绝不动 —— 那是把算过的亿级位点再算一遍。',
             'rule': 'REL-RETRY-001'},
        ],
        'pitfalls': [
            '把「假消失」当真删除直接删行 —— 共享盘挂载抖动会造成整批文件同时「消失」，删错就真没了。',
            '重试不分状态一把梭 —— parsed 的记录被重置，等于把算过的亿级位点再算一遍。',
            '多副本各扫各的、没有唯一键互斥 —— 同一文件被两轮扫描并发写，mtime 判变来回翻转。',
            '用 Thread.sleep 控制扫描节奏 —— 等待是调度问题，睡循环既不精确也不可观测。',
        ],
        'notSuitable': [
            '存储端有原生变更事件通知：轮询比对是下位替代，直接订阅事件即可。',
            '一次性全量且此后不再扫描：消失检测与重置机制没有对象。',
        ],
        'relatedRules': ['REL-CTNR-004', 'REL-RETRY-001', 'CONC-POOL-004'],
        'refs': [
            {'title': 'Google SRE · Data Integrity',
             'url': 'https://sre.google/sre-book/data-integrity/',
             'note': '对账（reconciliation）是增量管道消失检测的出处'},
            {'title': '《阿里巴巴 Java 开发手册》· 并发处理',
             'note': 'REL-CTNR-004 / CONC-POOL-004：多副本定时任务幂等与有界队列'},
        ],
    },
    {
        'id': 'variant-bulk-load',
        'order': 6,
        'goal': 'VCF 批量导入：砍掉参考基因型，多 ALT 拆行，按批提交',
        'layer': '数据访问',
        'when': {'parseDepth': ['variant', 'full'], 'scale': ['f5w', 'f20w', 'f100w']},
        'why': '一个 VCF 约 9.7 万行，数千个文件就是 5 亿行级别。'
               '逐条 INSERT、不跳过 0/0、多 ALT 合一行、整文件一个大事务 —— '
               '任何一条都会让导入时间和存储体积同时翻倍以上。',
        'decision': {
            'question': '亿级行怎么导进去？',
            'options': [
                '逐行 INSERT —— 网络往返放大两个数量级，几万文件按天算',
                '整个文件一个大事务 —— undo 膨胀、主从延迟，失败全部回滚重来',
                '按批提交 + 跳过 0/0 与 ./. + 多 ALT 拆行 + 唯一键防重 —— 断点续传靠唯一键',
                '先 LOAD DATA 到暂存表再换名 —— 最快，但与增量台账的一致性要自己做',
            ],
            'chosen': '按批提交（5000 行/批）+ 跳过参考基因型 + 多 ALT 拆行 + uk_variant 防重。'
                      '文件级重解析靠唯一键幂等，不做事务包整个文件',
            'tradeoff': '代价是位点查询要接受「无注释」的事实（富集是下游服务的事）；'
                        '收益是导入可中断可重入，行数对账（写入数 = VCF 行数 - 跳过数）能算清。',
        },
        'sql': r"""-- 变异位点表：文件维度防重 + 染色体分区。分区键必须进主键和唯一键，否则 MySQL 拒绝建表。
-- 查询主模式「某位点/区间有哪些样本携带」→ (chromosome, pos) 必须是索引前缀。
CREATE TABLE `sample_variant` (
  `id`            BIGINT       NOT NULL,
  `file_asset_id` BIGINT       NOT NULL COMMENT '来源 VCF。防重维度的锚',
  `case_id`       BIGINT       NULL COMMENT '冗余自 file_asset，方便病例维度聚合',
  `chromosome`    VARCHAR(8)   NOT NULL COMMENT '1..22,X,Y,MT —— 分区键',
  `pos`           INT          NOT NULL,
  `ref_allele`    VARCHAR(255) NOT NULL,
  `alt_allele`    VARCHAR(255) NOT NULL,
  `zygosity`      VARCHAR(8)   NOT NULL COMMENT 'het/hom/unknown，由 GT 推断',
  `depth`         INT          NULL,
  `allele_freq`   DECIMAL(6,5) NULL,
  `create_time`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`, `chromosome`),
  UNIQUE KEY `uk_variant` (`file_asset_id`, `chromosome`, `pos`, `ref_allele`, `alt_allele`),
  KEY `idx_locus` (`chromosome`, `pos`, `case_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY LIST COLUMNS (chromosome) (
  PARTITION p01 VALUES IN ('1'),  PARTITION p02 VALUES IN ('2'),
  PARTITION p03 VALUES IN ('3'),  PARTITION p04 VALUES IN ('4'),
  PARTITION p05 VALUES IN ('5'),  PARTITION p06 VALUES IN ('6'),
  PARTITION p07 VALUES IN ('7'),  PARTITION p08 VALUES IN ('8'),
  PARTITION p09 VALUES IN ('9'),  PARTITION p10 VALUES IN ('10'),
  PARTITION p11 VALUES IN ('11'), PARTITION p12 VALUES IN ('12'),
  PARTITION p13 VALUES IN ('13'), PARTITION p14 VALUES IN ('14'),
  PARTITION p15 VALUES IN ('15'), PARTITION p16 VALUES IN ('16'),
  PARTITION p17 VALUES IN ('17'), PARTITION p18 VALUES IN ('18'),
  PARTITION p19 VALUES IN ('19'), PARTITION p20 VALUES IN ('20'),
  PARTITION p21 VALUES IN ('21'), PARTITION p22 VALUES IN ('22'),
  PARTITION px  VALUES IN ('X'),  PARTITION py VALUES IN ('Y'),
  PARTITION pm  VALUES IN ('MT')
);
-- 唯一键含分区键 chromosome：这是 MySQL 分区表的硬约束，不是可选项。""",
        'code': r"""/**
 * 场景：多源文件入库与编号关联 / 切片：VCF 批量导入
 * 适用参数：解析深度 ≥ VCF 且文件数 ≥ 5 万
 * 依赖规则：DATA-SQL-001, SVC-TX-003, REL-TIME-001
 * JDK：17
 */
package com.example.inet.ingest.variant;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * VCF → sample_variant 的批量导入。
 *
 * 量级意识：一个 VCF 约 9.7 万行，数千个文件就是 5 亿行级别。
 * 逐条 INSERT、不跳过参考基因型、多 ALT 合一行 —— 任何一条都会让
 * 导入时间和存储体积同时翻倍以上。
 */
public final class VariantBatchLoader {

    /** 单批 5000 行：再大事务与包体积失控，再小网络往返吃掉收益。 */
    private static final int BATCH = 5000;

    private final VariantDao dao;

    public VariantBatchLoader(VariantDao dao) {
        this.dao = dao;
    }

    /**
     * 逐文件导入。返回写入行数 —— 扫描报告要靠它对账：
     * 写入数 = VCF 行数 − 跳过的 0/0 与 ./.。差额对不上才是事故。
     */
    public long load(long fileAssetId, Iterator<VcfRecord> rows) {
        long written = 0;
        List<VcfRecord> buf = new ArrayList<>(BATCH);
        while (rows.hasNext()) {
            VcfRecord r = rows.next();
            if (isNoCallOrRef(r.gt())) {
                continue; // 0/0 与 ./. 占九成以上：不砍掉它们，亿级变十亿级
            }
            if (r.alt().contains(",")) {
                // 多 ALT 拆行：各自带各自的 AD / AF。合一条写，位点查询会拿到串号的等位基因。
                for (String alt : r.alt().split(",")) {
                    buf.add(r.withAlt(alt.trim()));
                }
            } else {
                buf.add(r);
            }
            if (buf.size() >= BATCH) {
                written += flush(fileAssetId, buf);
                buf.clear();
            }
        }
        written += flush(fileAssetId, buf);
        return written;
    }

    private long flush(long fileAssetId, List<VcfRecord> buf) {
        if (buf.isEmpty()) {
            return 0;
        }
        // ON DUPLICATE KEY UPDATE 兜防重：同一文件重解析不会翻倍。
        // 这里刻意不用事务包住整个文件 —— 几十万行的长事务是另一场事故（SVC-TX-003）。
        return dao.insertBatch(fileAssetId, buf);
    }

    static boolean isNoCallOrRef(String gt) {
        return "0/0".equals(gt) || "./.".equals(gt) || "0|0".equals(gt) || ".|.".equals(gt);
    }

    /** 最小行模型：够导入用就行。注释信息的富集是下游注释服务的事，不在导入链路。 */
    public record VcfRecord(String chromosome, int pos, String ref, String alt,
                            String gt, Integer depth, Double alleleFreq) {
        VcfRecord withAlt(String alt) {
            return new VcfRecord(chromosome, pos, ref, alt, gt, depth, alleleFreq);
        }
    }

    public interface VariantDao {
        long insertBatch(long fileAssetId, List<VcfRecord> rows);
    }
}
""",
        'highlights': [
            {'mark': 'if (isNoCallOrRef(r.gt())) {',
             'title': '0/0 与 ./. 不入库',
             'text': '参考基因型与无调用占九成以上。跳过它们是亿级方案的前提 —— '
                     '这不是丢数据，是从一开始就不把「没有变异」当数据。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'for (String alt : r.alt().split(",")) {',
             'title': '多 ALT 拆行',
             'text': '一条 VCF 行可以有多个等位基因，各自的 AD / AF 必须跟对。'
                     '合在一条里存，位点查询会拿到串号的等位基因 —— 报告级错误。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'private static final int BATCH = 5000;',
             'title': '批量是有参数的工程决策',
             'text': '批大小是 IO 往返与事务体积的折中，必须是常量、可调、有注释 —— '
                     '散落的魔法数 5000 会让后人不敢动它。',
             'rule': 'SVC-TX-003'},
            {'mark': 'return dao.insertBatch(fileAssetId, buf);',
             'title': '按批提交，不用事务包文件',
             'text': '几十万行的长事务带来 undo 膨胀与主从延迟。断点续传靠唯一键幂等：'
                     '中断了就重来，重来的那批被 ON DUPLICATE KEY UPDATE 吃掉。',
             'rule': 'SVC-TX-003'},
        ],
        'pitfalls': [
            '逐行 INSERT —— 网络往返让导入时间放大两个数量级，几万文件按天算。',
            '整个文件包一个大事务 —— undo 膨胀、主从延迟，失败还要全部回滚重来。',
            '多 ALT 合一行存 —— 位点查询拿到串号的 AD / AF，报告级错误。',
            '重解析不做防重 —— uk_variant 缺失时重扫一遍，5 亿变 10 亿。',
        ],
        'notSuitable': [
            '变异文件已带注释且采用专用变异数据方案（列存 / HBase）：关系库只是过渡态，别把过渡态当终点打磨。',
            '文件数 < 5 万且无查询性能诉求：分区与批量参数退化为普通表 + 普通批插入即可。',
        ],
        'relatedRules': ['DATA-SQL-001', 'SVC-TX-003', 'REL-TIME-001'],
        'refs': [
            {'title': 'VCF Specification（hts-specs）',
             'url': 'https://samtools.github.io/hts-specs/',
             'note': 'GT 相态写法（0/0、0|0、./.）与多 ALT 字段语义'},
            {'title': 'MySQL 8.0 · Partitioning Limitations',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/partitioning-limitations.html',
             'note': '唯一键必须包含分区键'},
        ],
    },
    {
        'id': 'docx-clinical-extract',
        'order': 7,
        'goal': 'Word 报告解析：按文档原始顺序走混合块，空 ≠ 失败',
        'layer': '数据访问',
        'when': {'parseDepth': ['full']},
        'why': '报告模板不统一：标签与内容有时同段、有时分列、有时独占段落。'
               '「先所有段落再所有表格」的遍历顺序会让标签配到别人的内容上 —— 且配错不报错。'
               '三字段全空是模板问题（真实项目约 8%），不是解析失败。',
        'decision': {
            'question': '三种布局怎么兼容？',
            'options': [
                '只支持主流布局，其他记 failed —— 8% 的报告永远进不了检索',
                '每个模板写一个专用解析器 —— 模板数量不可控，维护成本指数涨',
                '混合块顺序遍历 + 三布局通用提取 + 标签词表配置化 —— 新模板加词，不加代码',
                '转 PDF 后 OCR —— 精度与成本都不成立，文本本来就在 docx 里',
            ],
            'chosen': '混合块顺序遍历 + 三布局通用提取。标签词表是数据；空占位符（- / 无 / 未提供）置 NULL',
            'tradeoff': '代价是「空结果」与「失败」必须严格区分，台账里多一类 report_empty_clinical；'
                        '收益是模板升级只改词表，且 92% 的报告无需任何人工。',
        },
        'sql': r"""-- 临床信息：与报告文件一对一（UNIQUE file_id）。三字段 + 报告日期 + 解析状态。
CREATE TABLE `clinical_info` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `file_id`        BIGINT       NOT NULL COMMENT '指向 file_asset 的 report_docx',
  `clinical_text`  TEXT         NULL COMMENT '占位符（- / 无 / 未提供）一律置 NULL',
  `family_history` TEXT         NULL,
  `focus_genes`    TEXT         NULL COMMENT '特殊关注基因或疾病',
  `report_date`    DATE         NULL,
  `parse_status`   VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'parsed/pending/failed；failed 自动重试一次',
  `fail_reason`    VARCHAR(512) NULL,
  `create_time`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_file` (`file_id`),
  KEY `idx_status` (`parse_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报告临床信息 · 一个报告文件一条记录';

-- 受检者样本：一个病例多个受检者（夫妻 / 家系 / 羊水标本）。
-- 它是「表型关键词 → 命中人物 → 定向关联 VCF/FASTQ」的桥。
CREATE TABLE `sample` (
  `id`            BIGINT      NOT NULL AUTO_INCREMENT,
  `case_id`       BIGINT      NOT NULL,
  `name`          VARCHAR(64) NOT NULL,
  `relationship`  VARCHAR(16) NOT NULL COMMENT 'self / mother / father / fetus / ...',
  `sample_code`   VARCHAR(32) NOT NULL COMMENT '完整编号，含成员后缀',
  `base_code`     VARCHAR(32) NOT NULL COMMENT '去成员后缀的基础编号',
  `member_suffix` VARCHAR(8)  NULL,
  `hospital_code` VARCHAR(32) NULL,
  `create_time`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_case_person` (`case_id`, `name`, `sample_code`),
  KEY `idx_base` (`base_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='受检者样本 · 表型关联的桥接表';""",
        'code': r"""/**
 * 场景：多源文件入库与编号关联 / 切片：Word 报告解析
 * 适用参数：解析深度 = VCF + 报告
 * 依赖规则：REL-EXCP-001, REL-EXCP-004, SEC-DATA-001
 * JDK：17
 */
package com.example.inet.report;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Word 报告 → 临床信息 + 受检者样本。
 *
 * 唯一的硬要求：按文档原始顺序遍历段落与表格的混合块，
 * 不是「先所有段落、再所有表格」。报告里的标签与内容经常一边一段一边一表，
 * 顺序一乱，「临床信息」四个字就会配到别人的内容上 —— 而且配错不报错。
 */
public final class ClinicalReportParser {

    /** 空占位符：这些值等于「没写」，必须置 NULL，不许把「无」当成内容存下去。 */
    static final Set<String> PLACEHOLDERS = Set.of("-", "—", "无", "无。", "未提供");

    /** 标签词表是数据：报告模板升级只改这一行，解析器不动。 */
    static final List<String> LABELS = List.of("临床信息", "家族史", "特殊关注基因或疾病");

    private final DocxReader reader;
    private final IssueRecorder issues;

    public ClinicalReportParser(DocxReader reader, IssueRecorder issues) {
        this.reader = reader;
        this.issues = issues;
    }

    public ClinicalInfo parse(long fileId, InputStream body) {
        ClinicalInfo info = new ClinicalInfo();
        try (DocxDocument doc = reader.open(body)) {
            for (DocxBlock block : doc.blocksInOrder()) {
                if (block.isTable()) {
                    info.merge(extractFromTable(block.asTable()));        // 布局②：标签独占一格，内容在同行下一格
                } else {
                    info.merge(extractFromParagraph(block.asParagraph())); // 布局①③：同段切分 / 标签独占段落
                }
            }
        } catch (DocxFormatException e) {
            // 非标准 OOXML（.doc 伪装、加密文档、LIMS 导出）：置 failed，下一轮自动重试一次。
            issues.record(IssueRecorder.REPORT_PARSE_ERROR, fileId, null, e.getMessage());
            throw e;
        }
        if (info.isAllBlank()) {
            // 三字段全空 ≠ 解析失败：真实项目约 8% 的报告模板不含标签词。
            // 记台账继续走，绝不置 failed —— 置错了会把 800 份正常报告送进无限重试。
            issues.record(IssueRecorder.REPORT_EMPTY_CLINICAL, fileId, null, "三字段为空，疑为模板不含标签");
        }
        return info;
    }

    /** 标签识别：标签后紧跟冒号（中英文）或空白才算 —— 避免「临床信息科医生」这类误配。 */
    static boolean isLabeled(String text, String label) {
        int i = text.indexOf(label);
        if (i < 0) {
            return false;
        }
        int next = i + label.length();
        if (next >= text.length()) {
            return true;
        }
        char c = text.charAt(next);
        return c == '：' || c == ':' || Character.isWhitespace(c);
    }

    private ClinicalInfo extractFromParagraph(String text) {
        ClinicalInfo info = new ClinicalInfo();
        for (String label : LABELS) {
            if (!isLabeled(text, label)) {
                continue;
            }
            int i = text.indexOf(label) + label.length();
            String value = normalize(text.substring(i));
            info.put(label, value);
        }
        return info;
    }

    private ClinicalInfo extractFromTable(DocxTable table) {
        ClinicalInfo info = new ClinicalInfo();
        for (DocxRow row : table.rows()) {
            List<String> cells = row.cells();
            for (int i = 0; i < cells.size() - 1; i++) {
                String label = cells.get(i).strip();
                for (String known : LABELS) {
                    if (label.equals(known)) { // 表格布局里标签必须整格相等，才取同行下一格
                        info.put(known, normalize(cells.get(i + 1)));
                    }
                }
            }
        }
        return info;
    }

    /** 空占位符统一归一为 null。检索「家族史」的人不该把成百上千份「无」当有效记录。 */
    static String normalize(String raw) {
        String v = raw == null ? "" : raw.strip();
        return PLACEHOLDERS.contains(v) ? null : v;
    }

    /** 可变聚合：标签 → 值。merge 语义 = 同标签后者覆盖，null 不覆盖已有值。 */
    public static final class ClinicalInfo {
        private final Map<String, String> values = new LinkedHashMap<>();

        void put(String label, String value) {
            if (value != null) {
                values.put(label, value);
            }
        }

        void merge(ClinicalInfo other) {
            other.values.forEach(this::put);
        }

        boolean isAllBlank() {
            return values.isEmpty()
                    || values.values().stream().allMatch(v -> v == null || v.isBlank());
        }
    }

    /** 对 POI 的薄封装：段落与表格按文档原始顺序给出。换实现只动这一层。 */
    public interface DocxReader {
        DocxDocument open(InputStream body);
    }

    public interface DocxDocument extends AutoCloseable {
        List<DocxBlock> blocksInOrder();

        @Override
        void close();
    }

    public interface DocxBlock {
        boolean isTable();

        String asParagraph();

        DocxTable asTable();
    }

    public interface DocxTable {
        List<DocxRow> rows();
    }

    public interface DocxRow {
        List<String> cells();
    }

    /** 非标准 OOXML：.doc 伪装、加密文档、LIMS 导出。置 failed 并自动重试一次。 */
    public static class DocxFormatException extends RuntimeException {
        public DocxFormatException(String message) {
            super(message);
        }
    }
}
""",
        'highlights': [
            {'mark': 'for (DocxBlock block : doc.blocksInOrder()) {',
             'title': '混合块按原始顺序遍历',
             'text': '标签与内容经常一边一段一边一表。先段落再表格的遍历会让标签配到别人的内容上，'
                     '而且配错不报错 —— 这是最阴的错法。',
             'rule': 'REL-EXCP-004'},
            {'mark': 'static final Set<String> PLACEHOLDERS = Set.of("-", "—", "无", "无。", "未提供");',
             'title': '空占位符置 NULL',
             'text': '「无」「未提供」等于没写。存成内容，检索「家族史」的人会把成百上千份「无」'
                     '当成有效记录，统计口径当场失真。',
             'rule': 'SEC-DATA-001'},
            {'mark': 'issues.record(IssueRecorder.REPORT_EMPTY_CLINICAL, fileId, null, "三字段为空，疑为模板不含标签");',
             'title': '空 ≠ 失败',
             'text': '三字段全空多数是模板不含标签词（真实项目约 8%）。'
                     '记台账继续走，置 failed 会把 800 份正常报告送进无限重试。',
             'rule': 'REL-EXCP-001'},
            {'mark': "return c == '：' || c == ':' || Character.isWhitespace(c);",
             'title': '标签判定防误配',
             'text': '「临床信息」后面跟冒号或空白才算标签 —— 否则「临床信息科医生」'
                     '这类文本会被当成标签命中，内容张冠李戴。',
             'rule': 'SEC-INPUT-001'},
        ],
        'pitfalls': [
            '先遍历所有段落再遍历所有表格 —— 标签与内容跨块穿插时配错对，且不报错，是最阴的错法。',
            '把「无」「未提供」当内容存 —— 表型检索把成百上千份「无」当有效记录，口径失真。',
            '三字段全空就置 failed 重试 —— 模板性空报告被送进无限重试，台账被冲成噪音。',
            '解析结果带患者姓名直接进日志 —— 报告内容比路径更敏感，脱敏层级只升不降。',
        ],
        'notSuitable': [
            '报告是模板统一的纯结构化表格：按模板坐标直接取值更稳，通用解析是给「模板不统一」的现实准备的。',
            '临床字段在 LIMS 已有结构化数据：别解析文档抢同一份数据，两处维护必然漂移。',
        ],
        'relatedRules': ['REL-EXCP-001', 'REL-EXCP-004', 'SEC-DATA-001', 'SEC-INPUT-001'],
        'refs': [
            {'title': 'Apache POI · XWPF（.docx）文档模型', 'url': 'https://poi.apache.org/',
             'note': '段落与表格按文档顺序遍历的实现基础'},
            {'title': '省妇幼项目 · 阶段5 解析实测',
             'note': '10,800 份报告：92% 提取到三字段，8% 模板不含标签，17 份非标准 OOXML'},
        ],
    },
    {
        'id': 'match-rate-guard',
        'order': 8,
        'goal': '匹配率守卫与人工确认：口径分离，告警不拦截',
        'layer': '运维',
        'when': {'idQuality': ['n70', 'n90']},
        'why': '编号规范化 ≤90% 时，匹配率的最后一段只能靠人工确认补齐。'
               '前提是「规则认不认识」和「库里有没有归属」分开统计 —— '
               '混成一个失败率，谁也不知道该改规则还是建通道。',
        'decision': {
            'question': '匹配率怎么管？',
            'options': [
                '一个总失败率 —— format_unknown 和 unmatched 搅在一起，改进方向靠猜',
                '低于阈值自动停扫 —— 仪表变闸门，先把人排除在回路外',
                '口径分离（unknown / unmatched / matched）+ 阈值告警 + 人工确认队列升级别名',
                '全部人工核对 —— 11,782 个文件等于让人去做机器擅长的事',
            ],
            'chosen': '口径分离 + 只告警不拦截 + 候选确认幂等升级。谁确认的必须留痕 —— '
                      '医疗数据里「这条关联谁拍的板」是审计的第一个问题',
            'tradeoff': '代价是确认队列需要人守（编号质量差的项目这是常态成本）；'
                        '收益是每一条关联都能回答「机器命中还是人确认」，数据可信可审计。',
        },
        'sql': r"""-- 编号候选映射表：匹配链走完仍无归属、但规则觉得「像」的编号关系在这里排队。
-- 它是候选，永远不许被查询链路当真；人工确认后升级进 case_identifier。
CREATE TABLE `identifier_mapping` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `id_type`       VARCHAR(16)  NOT NULL,
  `id_value`      VARCHAR(32)  NOT NULL,
  `guess_case_id` BIGINT       NULL COMMENT '规则猜测的病例，仅供参考，禁止直接使用',
  `evidence`      VARCHAR(512) NULL COMMENT '为什么觉得相关：同文件夹 / 同患者 / 相邻日期',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending / promoted / rejected',
  `decided_by`    VARCHAR(32)  NULL,
  `decided_at`    DATETIME(3)  NULL,
  `create_time`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_type_value` (`id_type`, `id_value`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='编号候选 · 人工确认后升级为正式别名';""",
        'code': r"""/**
 * 场景：多源文件入库与编号关联 / 切片：匹配率守卫与人工确认
 * 适用参数：编号规范化 ≤ 约 90%
 * 依赖规则：REL-LOG-002, SEC-LOG-001, SEC-AUTH-001
 * JDK：17
 */
package com.example.inet.ingest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 匹配率守卫：匹配率必须能被数出来，且口径分开 ——
 * 「规则认不认识」（format_unknown）和「库里有没有归属」（unmatched）
 * 是两类问题，混成一个数字会把改进方向搅在一起。
 */
public final class MatchRateGuard {

    private static final Logger log = LoggerFactory.getLogger(MatchRateGuard.class);

    /** unmatched 超过 5% 说明有系统性问题（比如某公司的新前缀没进规则表）。 */
    private static final double UNMATCHED_ALERT = 0.05;

    private final StatsDao stats;

    public MatchRateGuard(StatsDao stats) {
        this.stats = stats;
    }

    public Snapshot snapshot() {
        long total = stats.countTotal();
        if (total == 0) {
            return new Snapshot(0, 0, 0);
        }
        long unknown = stats.countByStatus("format_unknown"); // 规则没覆盖 → 改规则表
        long unmatched = stats.countByStatus("unmatched");    // 规则认得但没归属 → 人工确认
        return new Snapshot(
                (double) (total - unknown - unmatched) / total,
                (double) unknown / total,
                (double) unmatched / total);
    }

    /** 只告警不拦截：守卫是给人看的仪表，不是替人做决定的闸门。 */
    public void guard(Snapshot s) {
        if (s.unmatchedRate() > UNMATCHED_ALERT) {
            log.warn("unmatched 率 {} 超过 {}，检查规则表与人工确认队列",
                    s.unmatchedRate(), UNMATCHED_ALERT);
        }
    }

    /**
     * 人工确认后的升级：候选 → 正式别名。幂等：同一条候选重复确认只产生一条别名
     * （uk_type_value 兜底）。谁确认的必须留痕 —— 医疗数据里「这条关联谁拍的板」
     * 是审计的第一个问题。
     */
    public void promote(long mappingId, long caseId, String operator) {
        IdentifierMapping m = stats.loadMapping(mappingId);
        stats.upsertIdentifier(m.idType(), m.idValue(), caseId, "manual");
        stats.markPromoted(mappingId, operator);
    }

    /** 口径分离的快照：matched / unknown / unmatched 三者之和 = 全部。 */
    public record Snapshot(double matchedRate, double unknownRate, double unmatchedRate) {
    }

    public record IdentifierMapping(String idType, String idValue) {
    }

    public interface StatsDao {
        long countTotal();

        long countByStatus(String status);

        IdentifierMapping loadMapping(long mappingId);

        void upsertIdentifier(String idType, String idValue, long caseId, String source);

        void markPromoted(long mappingId, String operator);
    }
}
""",
        'highlights': [
            {'mark': 'long unknown = stats.countByStatus("format_unknown");',
             'title': '口径分离',
             'text': 'format_unknown 的答案是改规则表，unmatched 的答案是建人工通道。'
                     '合成一个「失败率」，谁都不知道下一步该改什么。',
             'rule': 'REL-LOG-002'},
            {'mark': 'private static final double UNMATCHED_ALERT = 0.05;',
             'title': '阈值是常量，告警不拦截',
             'text': '守卫是仪表不是闸门：unmatched 率高就通知人查，'
                     '不自动停扫描 —— 把人排除在回路外才是事故的开始。',
             'rule': 'REL-LOG-002'},
            {'mark': 'stats.upsertIdentifier(m.idType(), m.idValue(), caseId, "manual");',
             'title': '升级幂等',
             'text': '候选确认进 case_identifier 靠 uk_type_value 兜底：'
                     '同一条候选重复确认只产生一条别名，不会翻倍。',
             'rule': 'SEC-AUTH-001'},
            {'mark': 'stats.markPromoted(mappingId, operator);',
             'title': '确认人留痕',
             'text': '医疗数据里「这条关联谁拍的板」是审计的第一个问题。'
                     'decided_by 与 decided_at 是确认动作的一部分，不是可选装饰。',
             'rule': 'SEC-LOG-001'},
        ],
        'pitfalls': [
            '把 format_unknown 和 unmatched 合成一个「失败率」—— 前者改规则表，后者建人工通道，混在一起没法改。',
            '拿 guess_case_id 直接当关联结果 —— 候选表进了查询链路，猜测就固化成了事实。',
            '确认操作不留操作者 —— 数据出问题时，「谁确认的」是审计第一个要的答案。',
            '告警阈值顺便自动停扫 —— 仪表变闸门，人被排除在回路之外。',
        ],
        'notSuitable': [
            '编号规范化 ≥99% 且量级小：直接查台账里的 unmatched 明细就够，守卫与候选表是多余器官。',
            '已有统一可观测平台（指标、告警、看板齐全）：守卫只输出指标，别自建第二套告警。',
        ],
        'relatedRules': ['REL-LOG-002', 'SEC-LOG-001', 'SEC-AUTH-001'],
        'refs': [
            {'title': 'Google SRE · Alerting on SLOs',
             'url': 'https://sre.google/sre-book/alerting-on-slos/',
             'note': '告警给人看、不替人决定'},
            {'title': '省妇幼项目 · 虚拟 Case 管理页',
             'note': '候选确认与虚拟病例的前端落点'},
        ],
    },
]

CASE = {
    'id': 'multi-source-ingestion',
    'order': 7,
    'name': '多源文件入库与编号关联',
    'subtitle': '编号是纽带，宁可 unmatched 不许猜',
    'glyph': '⌗',
    'domain': ['医疗', '检验数据', '数据集成', '文件治理'],
    'problem': '三类文件散在多台机器多个共享盘，6 家公司命名规则各异，编号藏在文件夹名与文件名里；'
               '数万文件没有统一索引，VCF 内容还要逐行进亿级变异表。',
    'symptoms': [
        {'id': 'y1', 'text': "同一个病例的 VCF、FASTQ、报告对不上号，全靠人肉翻文件夹", 'params': {'parseDepth': 'full'}},
        {'id': 'y2', 'text': "重扫一遍重复入库，同一文件在库里出现 N 条", 'params': {'scanMode': 'periodic'}},
        {'id': 'y3', 'text': "匹配不上的文件被静默跳过，谁也说不清丢了多少、为什么丢", 'params': {'idQuality': 'n70'}},
        {'id': 'y4', 'text': "每接入一家新公司就要改一串 if-else，扫描脚本越来越长", 'params': {'scale': 'f20w'}},
    ],
    'recommended': {
        'scale': 'f5w', 'idQuality': 'n90', 'scanMode': 'periodic',
        'parseDepth': 'full', 'queryQps': 'solo', 'growth': 'g1x',
    },
    'drivers': DRIVERS,
    'conflicts': CONFLICTS,
    'slices': SLICES,
    'notSuitableFor': NOT_SUITABLE_FOR,
    'benchmark': BENCHMARK,
    'architecture': ARCHITECTURE,
}
