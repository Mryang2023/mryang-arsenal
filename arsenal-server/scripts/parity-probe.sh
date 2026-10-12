#!/usr/bin/env bash
#
# arsenal-server/scripts/parity-probe.sh —— 编译并运行两端一致性探针（后端侧）
#
# 与 compile-check.sh 的区别：compile-check 只编译 src/main/java（产品代码），
# 这里额外把 .verify/ParityProbe.java 编进来 —— 它是校验工具，不该混进产品代码目录。
#
# 用法:
#   bash scripts/parity-probe.sh <rulesDir> <outDir> <severitiesCsv> <categoriesCsv>
#
# 过滤条件由调用方传入、本脚本不替它决定 —— 两端必须用同一批参数，
# 否则比的是两件事（这个坑真的踩过：探针自己写了一份 MUST/NEVER/SHOULD/MAY）。
#
# 通常不直接调用，由 arsenal-web/.verify/parity-check.ts 编排（它还要跑前端那一半）。
# 可用环境变量覆盖：JDK_HOME、M2_REPO
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"

if [ "$#" -lt 4 ]; then
  echo "用法: bash scripts/parity-probe.sh <rulesDir> <outDir> <severitiesCsv> <categoriesCsv>" >&2
  echo "  例: bash scripts/parity-probe.sh ../arsenal-rules ./target/parity-be MUST,NEVER,SHOULD skeleton,web" >&2
  exit 2
fi

RULES_DIR="$(cd "$1" && pwd)" || { echo "[FAIL] 规则目录不存在：$1" >&2; exit 1; }
OUT_DIR="$2"
SEVERITIES_CSV="$3"
CATEGORIES_CSV="$4"
mkdir -p "$OUT_DIR" || { echo "[FAIL] 无法创建输出目录：$OUT_DIR" >&2; exit 1; }

# shellcheck source=./_cp.sh
source "$HERE/_cp.sh" || exit 1

JAVA="$JDK_DIR/bin/java.exe"
[ -x "$JAVA" ] || JAVA="$JDK_DIR/bin/java"
[ -x "$JAVA" ] || { echo "[FAIL] $JDK_DIR 下没有 java" >&2; exit 1; }

cd "$SERVER_ROOT" || exit 1

CLASSES="target/parity"
rm -rf "$CLASSES" && mkdir -p "$CLASSES"

mapfile -t SRC < <(find src/main/java -name "*.java" | sort)
SRC+=(".verify/ParityProbe.java")

# 探针编译失败就是硬失败 —— 它是「两端不漂移」这条约束的守门人，
# 守门人自己坏了却继续往下跑，比没有守门人更糟。
if ! "$JAVAC" -encoding UTF-8 -nowarn -d "$CLASSES" -cp "$CP" "${SRC[@]}"; then
  echo "[FAIL] 探针编译失败（后端源码或 ParityProbe.java 有误）" >&2
  exit 1
fi

# 传给 JVM 的路径必须转成 Windows 风格 —— 这里是踩过的坑：
# 漏转时 java 把 /d/workspace/... 当成「当前盘根下的 d/workspace/...」，
# 于是报「目录下没有 meta.json」，看起来像规则目录本身有问题。
#
# stdout/stderr.encoding 是为了让探针的中文报错可读：Windows 控制台默认
# cp936，JVM 按 cp936 写出、Node 按 UTF-8 读入，报错就变成一串「�÷÷」，
# 恰好把最有用的那一行糊掉。主服务已升 JDK 21，用 19+ 的标准属性名
# （sun.* 那对是 17 时代的别名）。
"$JAVA" -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 \
  -cp "$(to_win "$SERVER_ROOT/$CLASSES");$CP" \
  ParityProbe "$(to_win "$RULES_DIR")" "$(to_win "$OUT_DIR")" "$SEVERITIES_CSV" "$CATEGORIES_CSV"
