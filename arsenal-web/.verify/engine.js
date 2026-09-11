"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globToRegExp = globToRegExp;
exports.lint = lint;
const theme_1 = require("./theme");
const MAX_HITS_PER_RULE_PER_FILE = 200;
const MAX_REPORTED_PER_RULE_PER_FILE = 5;
const SNIPPET_MAX = 140;
function escapeLiteral(s) {
    return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}
/**
 * glob → RegExp。支持 `**`（跨目录）、`*`（单层）、`?`、`{a,b}`。
 * 文件名按 posix 风格比较，不区分大小写。
 */
function globToRegExp(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                i++;
                if (glob[i + 1] === '/') {
                    i++;
                    out += '(?:.*/)?'; // **/ 允许零层目录
                }
                else {
                    out += '.*';
                }
            }
            else {
                out += '[^/]*';
            }
        }
        else if (c === '?') {
            out += '[^/]';
        }
        else if (c === '{') {
            const end = glob.indexOf('}', i);
            if (end === -1) {
                out += '\\{';
            }
            else {
                const alts = glob.slice(i + 1, end).split(',').map(escapeLiteral);
                out += '(?:' + alts.join('|') + ')';
                i = end;
            }
        }
        else {
            out += escapeLiteral(c);
        }
    }
    return new RegExp('^' + out + '$', 'i');
}
function normalizePath(p) {
    return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}
/** 预建换行索引 + 二分定位，避免每个命中都线性扫全文 */
function makeLocator(text) {
    const nl = [];
    for (let i = 0; i < text.length; i++)
        if (text.charCodeAt(i) === 10)
            nl.push(i);
    return (index) => {
        let lo = 0;
        let hi = nl.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (nl[mid] < index)
                lo = mid + 1;
            else
                hi = mid;
        }
        const lineStart = lo === 0 ? 0 : nl[lo - 1] + 1;
        return { line: lo + 1, column: index - lineStart + 1 };
    };
}
function snippetAt(text, index, matchText) {
    const lineStart = text.lastIndexOf('\n', index) + 1;
    let lineEnd = text.indexOf('\n', index);
    if (lineEnd === -1)
        lineEnd = text.length;
    let s = text.slice(lineStart, lineEnd).trim();
    if (!s && matchText)
        s = matchText.split('\n')[0].trim();
    if (s.length > SNIPPET_MAX)
        s = s.slice(0, SNIPPET_MAX) + '…';
    return s;
}
function collectMatches(re, text) {
    const out = [];
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(text)) !== null) {
        out.push({ index: m.index, text: m[0] });
        // 零宽匹配保护，否则 lastIndex 不前进会死循环
        if (m[0] === '')
            re.lastIndex += 1;
        if (++guard > 20000)
            break;
        if (out.length >= MAX_HITS_PER_RULE_PER_FILE)
            break;
    }
    return out;
}
function grade(score) {
    if (score >= 95)
        return '合规';
    if (score >= 85)
        return '良好';
    if (score >= 70)
        return '及格';
    if (score >= 50)
        return '不合格';
    return '严重违规';
}
/**
 * Level 1 校验引擎（文本层）。
 *
 * 只执行 check.regex 层——这是零成本、可离线、确定性的那一层。
 * 其余层（ast / llm / manual）不在此处伪造判定，一律进 skipped 清单如实披露，
 * 交由后端 Level 1b（JavaParser）与 Level 2（LLM）处理。
 *
 * 原则：宁可说「这条我检不了」，也不要给一个假阳性把用户带偏。
 */
function lint(files, rules) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const active = rules.filter((r) => r.status === 'active');
    const executable = active.filter((r) => r.check?.regex?.pattern);
    const skipped = active
        .filter((r) => !r.check?.regex?.pattern)
        .map((r) => ({
        ruleId: r.id,
        title: r.title,
        severity: r.severity,
        category: r.category,
        layer: r.check?.ast?.query ? 'ast' : r.check?.llm ? 'llm' : 'manual',
        reason: r.check?.ast?.query
            ? '需 Java AST 解析 —— 交由后端 Level 1b（JavaParser）'
            : r.check?.llm
                ? '需语义判定 —— 交由后端 Level 2（LLM，强制行号定位）'
                : '无法自动判定 —— 需人工过目',
    }));
    const compiled = [];
    const broken = [];
    for (const r of executable) {
        const rc = r.check.regex;
        let body = null;
        try {
            const extra = (rc.flags ?? '').replace(/[gm]/g, '');
            body = new RegExp(rc.pattern, 'gm' + extra);
        }
        catch {
            body = null;
        }
        if (!body) {
            broken.push({
                ruleId: r.id, title: r.title, severity: r.severity, category: r.category,
                layer: 'regex', reason: '规则自身的正则表达式无法编译 —— 这是规则缺陷，请修复',
            });
            continue;
        }
        compiled.push({
            rule: r,
            body,
            fileRe: rc.targetGlob ? globToRegExp(normalizePath(rc.targetGlob)) : null,
            expect: rc.expect ?? 'absent',
        });
    }
    const violations = [];
    let totalLines = 0;
    let matchedFiles = 0;
    let notApplicable = 0;
    const ruleFileHits = new Map();
    for (const file of files) {
        const name = normalizePath(file.name || 'untitled.java');
        const text = file.content ?? '';
        totalLines += text ? text.split('\n').length : 0;
        const locate = makeLocator(text);
        let fileTouched = false;
        for (const c of compiled) {
            if (c.fileRe && !c.fileRe.test(name)) {
                notApplicable++;
                continue;
            }
            fileTouched = true;
            const hits = collectMatches(c.body, text);
            const isViolation = c.expect === 'absent' ? hits.length > 0 : hits.length === 0;
            if (!isViolation)
                continue;
            // 同一行只报一次，避免重复噪音
            const seenLines = new Set();
            const picked = [];
            for (const h of hits) {
                const { line, column } = locate(h.index);
                if (seenLines.has(line))
                    continue;
                seenLines.add(line);
                if (picked.length < MAX_REPORTED_PER_RULE_PER_FILE) {
                    picked.push({ line, column, snippet: snippetAt(text, h.index, h.text) });
                }
            }
            if (c.expect === 'present' && picked.length === 0) {
                picked.push({
                    line: 1, column: 1,
                    snippet: `未找到必需内容：${c.rule.title}`,
                });
            }
            const collapsed = Math.max(0, seenLines.size - picked.length);
            for (const p of picked) {
                violations.push({
                    ruleId: c.rule.id,
                    title: c.rule.title,
                    severity: c.rule.severity,
                    category: c.rule.category,
                    file: name,
                    line: p.line,
                    column: p.column,
                    snippet: p.snippet,
                    message: c.expect === 'present' ? '缺少必需写法' : '命中禁止写法',
                    fix: c.rule.promptFragment,
                    collapsed: 0,
                });
            }
            if (collapsed > 0 && violations.length) {
                violations[violations.length - 1].collapsed = collapsed;
            }
            const key = c.rule.id;
            const set = ruleFileHits.get(key) ?? new Set();
            set.add(name);
            ruleFileHits.set(key, set);
        }
        if (fileTouched)
            matchedFiles++;
    }
    // ---- 评分：按规则违规计罚，同一规则多处违规按出现次数递增但封顶 ----
    const perRuleCount = new Map();
    for (const v of violations)
        perRuleCount.set(v.ruleId, (perRuleCount.get(v.ruleId) ?? 0) + 1);
    let penalty = 0;
    for (const [ruleId, count] of perRuleCount) {
        const rule = rules.find((r) => r.id === ruleId);
        const base = theme_1.SEVERITY_THEME[rule?.severity ?? 'SHOULD'].penalty;
        penalty += base + Math.min(count - 1, 4);
    }
    const score = Math.max(0, Math.min(100, 100 - penalty));
    const counts = { MUST: 0, NEVER: 0, SHOULD: 0, MAY: 0 };
    const catCount = new Map();
    for (const v of violations) {
        counts[v.severity] += 1;
        const cur = catCount.get(v.category);
        if (!cur)
            catCount.set(v.category, { count: 1, severity: v.severity });
        else
            cur.count += 1;
    }
    const byRule = [...perRuleCount.entries()]
        .map(([ruleId, count]) => {
        const rule = rules.find((r) => r.id === ruleId);
        return {
            ruleId,
            title: rule.title,
            severity: rule.severity,
            category: rule.category,
            count,
            files: ruleFileHits.get(ruleId)?.size ?? 1,
        };
    })
        .sort((a, b) => theme_1.SEVERITY_THEME[b.severity].penalty - theme_1.SEVERITY_THEME[a.severity].penalty || b.count - a.count);
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
        fileCount: files.length,
        totalLines,
        rulePool: active.length,
        executableRules: compiled.length,
        matchedFiles,
        notApplicable,
        violations: violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
        skipped: [...skipped, ...broken],
        score,
        grade: grade(score),
        counts,
        byCategory: [...catCount.entries()].map(([category, v]) => ({ category, ...v })),
        byRule,
        durationMs: Math.round(t1 - t0),
    };
}
