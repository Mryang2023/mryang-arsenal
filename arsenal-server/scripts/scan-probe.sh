#!/usr/bin/env bash
#
# arsenal-server/scripts/scan-probe.sh —— 编译并运行扫描引擎探针
#
# 与 archify-probe.sh 同一套路：产品代码只编 src/main/java，
# 探针 .verify/ScanProbe.java 额外编进来（它是校验工具，不该混进产品目录）。
#
# 用法:
#   bash scripts/scan-probe.sh <out.json> <动作> [动作...]
#   例: bash scripts/scan-probe.sh ../arsenal-web/.verify/tmp/scan-check/probe.json \
#         "facts:../arsenal-web/.verify/fixtures/demo-repo" "git:file:///etc"
#
# 退出码:
#   0  探针跑完（输入被拒也算跑完 —— 收据里 ok=false + code，由调用方断言）
#   1  编译失败或 java 起不来
#   2  参数不对
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"

if [ "$#" -lt 2 ]; then
  echo "用法: bash scripts/scan-probe.sh <out.json> <动作> [动作...]" >&2
  exit 2
fi

OUT="$1"
shift
ACTIONS=("$@")

# shellcheck source=./_cp.sh
source "$HERE/_cp.sh" || exit 1

JAVA="$JDK_DIR/bin/java.exe"
[ -x "$JAVA" ] || JAVA="$JDK_DIR/bin/java"
[ -x "$JAVA" ] || { echo "[FAIL] $JDK_DIR 下没有 java" >&2; exit 1; }

cd "$SERVER_ROOT" || exit 1

CLASSES="target/scan-probe"
rm -rf "$CLASSES" && mkdir -p "$CLASSES"

mapfile -t SRC < <(find src/main/java -name "*.java" | sort)
SRC+=(".verify/ScanProbe.java")

if ! "$JAVAC" -encoding UTF-8 -nowarn -d "$CLASSES" -cp "$CP" "${SRC[@]}"; then
  echo "[FAIL] 探针编译失败（后端源码或 ScanProbe.java 有误）" >&2
  exit 1
fi

"$JAVA" -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -Dfile.encoding=UTF-8 \
  -cp "$(to_win "$SERVER_ROOT/$CLASSES");$CP" \
  ScanProbe "$(to_win "$OUT")" "${ACTIONS[@]}"
