"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_TYPE_LABEL = exports.CHECK_LAYER_THEME = exports.SEVERITY_ORDER = exports.SEVERITY_THEME = exports.CATEGORY_ORDER = exports.CATEGORY_THEME = void 0;
/** 九大类的识别色。用内联色值而非 Tailwind 类，避免动态类名被 purge 掉。 */
exports.CATEGORY_THEME = {
    skeleton: { key: 'skeleton', name: '工程骨架', english: 'Skeleton', color: '#8B9DC3', blurb: '项目结构、包命名、依赖与配置', glyph: '▤' },
    web: { key: 'web', name: 'Web 层', english: 'Web', color: '#4FB0C6', blurb: 'Controller 职责、入参出参契约、校验出口', glyph: '⇄' },
    service: { key: 'service', name: '业务层', english: 'Service', color: '#7FA650', blurb: '分层边界、事务、注入与业务异常', glyph: '⚙' },
    data: { key: 'data', name: '数据层', english: 'Data', color: '#C9A227', blurb: 'SQL 写法、表结构、索引与分页', glyph: '▦' },
    concurrency: { key: 'concurrency', name: '并发', english: 'Concurrency', color: '#E5734B', blurb: '线程池、ThreadLocal、时间格式化', glyph: '⇉' },
    reliability: { key: 'reliability', name: '可靠性', english: 'Reliability', color: '#B085D6', blurb: '异常、日志、重试退避与超时', glyph: '◈' },
    security: { key: 'security', name: '安全', english: 'Security', color: '#E5484D', blurb: '注入、反序列化、凭据与脱敏', glyph: '⛨' },
    test: { key: 'test', name: '测试', english: 'Test', color: '#56C596', blurb: '测试结构、命名与断言', glyph: '✓' },
    collab: { key: 'collab', name: '协作', english: 'Collab', color: '#9C8AA5', blurb: 'Git 提交、分支与文档约定', glyph: '⎇' },
};
exports.CATEGORY_ORDER = [
    'skeleton', 'web', 'service', 'data', 'concurrency',
    'reliability', 'security', 'test', 'collab',
];
exports.SEVERITY_THEME = {
    MUST: { label: '强制', code: 'MUST', color: '#E5484D', soft: 'rgba(229,72,77,0.13)', meaning: '硬约束。违反必修，计入合规分。', blocking: true, penalty: 6 },
    NEVER: { label: '禁止', code: 'NEVER', color: '#C026D3', soft: 'rgba(192,38,211,0.13)', meaning: '明令禁止。与强制同级阻断。', blocking: true, penalty: 6 },
    SHOULD: { label: '建议', code: 'SHOULD', color: '#D9A441', soft: 'rgba(217,164,65,0.13)', meaning: '强烈建议。违反不计分，报告中列出。', blocking: false, penalty: 2 },
    MAY: { label: '可选', code: 'MAY', color: '#6E8FA8', soft: 'rgba(110,143,168,0.13)', meaning: '可选风格。仅作提示词参考，不参与校验。', blocking: false, penalty: 0 },
};
exports.SEVERITY_ORDER = ['MUST', 'NEVER', 'SHOULD', 'MAY'];
exports.CHECK_LAYER_THEME = {
    regex: { label: '正则', color: '#56C596', desc: '文本层，零成本即时判定', auto: true },
    ast: { label: 'AST', color: '#4FB0C6', desc: '语法树层，需 Java 解析器', auto: false },
    llm: { label: '语义', color: '#B085D6', desc: 'LLM 判定，必须带行号定位', auto: false },
    manual: { label: '人工', color: '#8B9DC3', desc: '无法自动判定，需人工过目', auto: false },
};
exports.SOURCE_TYPE_LABEL = {
    'industry-standard': '行业规范',
    'framework-doc': '框架文档',
    spec: '技术标准',
    book: '经典著作',
    'security-baseline': '安全基线',
    'project-decision': '项目决策',
};
