/**
 * 极简语法着色。
 *
 * 只做转义 + 少量 token 着色，不引第三方高亮库 —— 军火库要能离线、
 * 要能在任何环境构建，多一个依赖就多一个长期负担。
 */

const C = {
  comment: '#5A6A63',
  string: '#9DD1A0',
  keyword: '#C792EA',
  anno: '#D9A441',
  number: '#E5A87C',
  type: '#7FC8DC',
  tag: '#4FB0C6',
  attr: '#C9A227',
  key: '#8B9DC3',
};

export type HighlightLang = 'java' | 'sql' | 'xml' | 'yaml' | 'json' | 'text';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(color: string, text: string): string {
  return `<span style="color:${color}">${text}</span>`;
}

const JAVA_RE = new RegExp(
  [
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1 注释
    '("(?:\\\\.|[^"\\\\])*")', // 2 字符串
    "('(?:\\\\.|[^'\\\\])*')", // 3 字符
    '(@[A-Za-z_][\\w.]*)', // 4 注解
    '\\b(public|private|protected|static|final|abstract|synchronized|volatile|transient|native|strictfp|class|interface|enum|record|extends|implements|void|return|new|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|throws|import|package|this|super|null|true|false|instanceof|var|int|long|double|float|boolean|char|byte|short)\\b', // 5 关键字
    '\\b([A-Z][A-Za-z0-9_]*)\\b', // 6 类型
    '\\b(\\d+(?:\\.\\d+)?[LlFfDd]?)\\b', // 7 数字
  ].join('|'),
  'g'
);

const SQL_RE = new RegExp(
  [
    "(--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)",
    "('(?:''|[^'])*')",
    '\\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TRUNCATE|TABLE|VIEW|INDEX|PRIMARY|FOREIGN|KEY|UNIQUE|NOT|NULL|DEFAULT|AUTO_INCREMENT|AND|OR|IN|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|COUNT|SUM|AVG|MAX|MIN|CASE|WHEN|THEN|ELSE|END|EXISTS|LIKE|BETWEEN|IS|ASC|DESC|COMMENT|USING|VARCHAR|CHAR|INT|INTEGER|BIGINT|SMALLINT|TINYINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|DATE|DATETIME|TIMESTAMP|TIME|YEAR|TEXT|BLOB|BOOLEAN|ENUM|JSON|UNSIGNED|CHARSET|COLLATE|ENGINE|EXPLAIN|FORCE|USE)\\b',
  ].join('|'),
  'gi'
);

const XML_RE = /(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?)([A-Za-z_][\w.:-]*)|("[^"]*")|(\/?&gt;)/g;
const YAML_RE = /(#.*$)|^(\s*-?\s*)([A-Za-z_][\w.-]*)(\s*:)/gm;
const JSON_RE = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;

export function highlight(code: string, lang: HighlightLang = 'java'): string {
  const src = escapeHtml(code ?? '');

  switch (lang) {
    case 'java':
      return src.replace(JAVA_RE, (m, cm, str, ch, an, kw, ty, num) => {
        if (cm) return span(C.comment, cm);
        if (str) return span(C.string, str);
        if (ch) return span(C.string, ch);
        if (an) return span(C.anno, an);
        if (kw) return span(C.keyword, kw);
        if (ty) return span(C.type, ty);
        if (num) return span(C.number, num);
        return m;
      });

    case 'sql':
      return src.replace(SQL_RE, (m, cm, str, kw) => {
        if (cm) return span(C.comment, cm);
        if (str) return span(C.string, str);
        if (kw) return span(C.keyword, kw);
        return m;
      });

    case 'xml':
      return src.replace(XML_RE, (m, cm, open, name, attr, close) => {
        if (cm) return span(C.comment, cm);
        if (open && name) return span(C.tag, open) + span(C.attr, name);
        if (attr) return span(C.string, attr);
        if (close) return span(C.tag, close);
        return m;
      });

    case 'yaml':
      return src.replace(YAML_RE, (m, cm, indent, key, colon) => {
        if (cm) return span(C.comment, cm);
        if (key) return indent + span(C.key, key) + colon;
        return m;
      });

    case 'json':
      return src.replace(JSON_RE, (m, key, str, lit, num) => {
        if (key) return span(C.key, key);
        if (str) return span(C.string, str);
        if (lit) return span(C.keyword, lit);
        if (num) return span(C.number, num);
        return m;
      });

    default:
      return src;
  }
}

/**
 * 把着色后的 HTML 按行切开，同时保持跨行 span 不被打散。
 *
 * 为什么需要它：块注释会跨多行，一次着色后是一个整体。
 * 直接按换行符切字符串会把 span 截断，渲染出来就是一堆裸露的标签。
 * 这里用「栈」记录每行结束时仍未闭合的 span，切行时补齐开闭标签。
 *
 * 安全性说明：输入已由 escapeHtml 转义，代码里的 < > 都变成了实体，
 * 所以这里能安全地按 '<span' 前缀做状态机解析。
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  let i = 0;

  while (i < html.length) {
    if (html.startsWith('<span', i)) {
      const end = html.indexOf('>', i);
      if (end < 0) {
        current += html[i];
        i += 1;
        continue;
      }
      const tag = html.slice(i, end + 1);
      open.push(tag);
      current += tag;
      i = end + 1;
    } else if (html.startsWith('</span>', i)) {
      open.pop();
      current += '</span>';
      i += 7;
    } else if (html[i] === '\n') {
      current += '</span>'.repeat(open.length);
      lines.push(current);
      current = open.join('');
      i += 1;
    } else {
      current += html[i];
      i += 1;
    }
  }
  lines.push(current);
  return lines;
}

export function normalizeLang(raw?: string): HighlightLang {
  const s = (raw ?? '').toLowerCase().trim();
  if (s === 'java') return 'java';
  if (s === 'sql') return 'sql';
  if (s === 'xml' || s === 'html') return 'xml';
  if (s === 'yml' || s === 'yaml' || s === 'properties') return 'yaml';
  if (s === 'json' || s === 'jsonc') return 'json';
  return 'text';
}
