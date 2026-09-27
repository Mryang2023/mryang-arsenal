#!/usr/bin/env bash
#
# arsenal-server/scripts/ast-probe.sh —— 编译并运行 AST 层探针（AstProbe）
#
# 与 parity-probe.sh 的分工：那边管「两端导出一致」，这边管「AST 层真的被 LintEngine
# 驱动」—— 15 个语法层检查器全部产生带行号违规、5 条类型依赖规则诚实留在 skipped。
# 单独一个脚本：一个探针坏了不许拖累另一个的记账（parity-check.ts 对两个探针
# 各自记账，哪个起不来哪个如实 skip，互不株连）。
#
# 为什么必须有它：在此之前 AstProbe.java 全仓 0 引用、从未编译执行 ——
# 一次重构可以让 AST 检查器全部静默失效而 verify 照样全绿。
#
# 用法:
#   bash scripts/ast-probe.sh <rulesDir>
#
# 过滤条件不需要：AstProbe 直读规则目录全量（lint 不做 severities/categories 过滤）。
# 通常不直接调用，由 arsenal-web/.verify/parity-check.ts 编排。
# 可用环境变量覆盖：JDK_HOME、M2_REPO（见 _cp.sh）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"

if [ "$#" -lt 1 ]; then
  echo "用法: bash scripts/ast-probe.sh <rulesDir>" >&2
  echo "  例: bash scripts/ast-probe.sh ../arsenal-rules" >&2
  exit 2
fi

RULES_DIR="$(cd "$1" && pwd)" || { echo "[FAIL] 规则目录不存在：$1" >&2; exit 1; }

# shellcheck source=./_cp.sh
source "$HERE/_cp.sh" || exit 1

JAVA="$JDK_DIR/bin/java.exe"
[ -x "$JAVA" ] || JAVA="$JDK_DIR/bin/java"
[ -x "$JAVA" ] || { echo "[FAIL] $JDK_DIR 下没有 java" >&2; exit 1; }

cd "$SERVER_ROOT" || exit 1

# 刻意不用 target/parity 的产物：探针必须编「当前源码」，复用旧 classes
# 等于拿昨天的结论守今天的门 —— 静默失效正是本探针要抓的东西。
CLASSES="target/ast-probe"
rm -rf "$CLASSES" && mkdir -p "$CLASSES"

mapfile -t SRC < <(find src/main/java -name "*.java" | sort)
SRC+=(".verify/AstProbe.java")

# 探针编译失败就是硬失败 —— 守门人自己坏了却继续往下跑，比没有守门人更糟。
if ! "$JAVAC" -encoding UTF-8 -nowarn -d "$CLASSES" -cp "$CP" "${SRC[@]}"; then
  echo "[FAIL] AstProbe 编译失败（后端源码或 AstProbe.java 有误）" >&2
  exit 1
fi

# 路径转 Windows 风格 + UTF-8 输出，理由同 parity-probe.sh（那边踩过的坑不重踩）。
"$JAVA" -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 \
  -cp "$(to_win "$SERVER_ROOT/$CLASSES");$CP" \
  AstProbe "$(to_win "$RULES_DIR")"
