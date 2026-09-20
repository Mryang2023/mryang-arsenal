#!/usr/bin/env bash
#
# arsenal-server 静态编译校验（无需 Maven）
#
# Why: 本机没有 mvn，但仍需要确定性地回答「这套代码能不能编译」。
# 用 JDK 17 + 本地 .m2 里已有的 Spring Boot 依赖跑 javac，
# 能抓住语法错误、API 误用、泛型不匹配、lambda 捕获等问题。
#
# 用法:
#   bash scripts/compile-check.sh
# 可覆盖的环境变量:
#   JDK_HOME   JDK 17 安装目录（不含 /bin）。不指定则自动扫 .jdks 与常见安装位置
#   M2_REPO    本地 Maven 仓库
#
# JDK 与依赖类路径的定位逻辑在 scripts/_cp.sh，与 parity-probe.sh 共用一份。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"

# shellcheck source=./_cp.sh
source "$HERE/_cp.sh" || exit 1

cd "$SERVER_ROOT" || exit 1

# 用数组而不是 $SOURCES 裸展开：路径里带空格时裸展开会断词，
# 而断词的表现是「javac 报一个看起来像语法错误的错」，很难联想到是引号问题。
mapfile -t SOURCES < <(find src/main/java -name "*.java" | sort)
COUNT="${#SOURCES[@]}"

mkdir -p target/classes

echo "JDK    : $("$JAVAC" -version 2>&1)   ($JDK_DIR)"
echo "Sources: $COUNT files"
echo "Output : $SERVER_ROOT/target/classes"
echo ""

if "$JAVAC" -encoding UTF-8 -nowarn -d target/classes -cp "$CP" "${SOURCES[@]}"; then
  CLASSES=$(find target/classes -name "*.class" | wc -l | tr -d ' ')
  echo ""
  echo "[OK] compiled: $COUNT sources -> $CLASSES classes"
  echo ""
  echo "Note: static compile proves syntax/API correctness only, not runtime behavior."
  echo "      To actually run it you need Maven: mvn spring-boot:run  (port 3011)"
else
  echo ""
  echo "[FAIL] compilation errors above" >&2
  exit 1
fi
