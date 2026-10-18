#!/usr/bin/env bash
#
# arsenal-server/scripts/projects-probe.sh —— 编译并运行项目工坊摄取安全探针
#
# 与 scan-probe.sh 同一套路：产品代码只编 src/main/java，
# 探针 .verify/ProjectsProbe.java 额外编进来（它是校验工具，不该混进产品目录）。
#
# 用法:
#   bash scripts/projects-probe.sh <out.json> <动作> [动作...]
#   例: bash scripts/projects-probe.sh ../arsenal-web/.verify/tmp/projects/probe.json \
#         "gate:../arsenal-web/.verify/tmp/projects/work-gate"
#
# 退出码:
#   0  探针跑完（输入被拒也算跑完 —— 收据里 ok=false，由调用方断言）
#   1  编译失败或 java 起不来
#   2  参数不对
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"

if [ "$#" -lt 2 ]; then
  echo "用法: bash scripts/projects-probe.sh <out.json> <动作> [动作...]" >&2
  exit 2
fi

OUT="$1"
shift
ACTIONS=("$@")

# ── 前置校验：动作参数不许为空、必须是 Windows 绝对路径 ──────────
# 2026-10-18 险肇：调用方一次转义失误（to_win 未定义）让参数变空串，
# 探针的 Paths.get("") 落到进程 cwd（arsenal-server 根），夹具准备把
# src/main/java 整棵树 rmrf 了（靠 git 恢复）。所以这里先拦一道，
# java 里还有第二道（workDir 校验 + rmrf 安全网）—— 两层都不许拆。
for a in "${ACTIONS[@]}"; do
  case "$a" in
    *:*) param="${a#*:}" ;;
    *)
      echo "[FAIL] 动作缺少参数（应为 动词:路径）：$a" >&2
      exit 2 ;;
  esac
  case "$param" in
    "")
      echo "[FAIL] 动作参数为空：疑似调用方路径转义失误，拒绝起跑" >&2
      exit 2 ;;
    [A-Za-z]:*) ;;  # Windows 绝对路径，放行
    *)
      echo "[FAIL] 动作参数不是 Windows 绝对路径：$a" >&2
      exit 2 ;;
  esac
done

# shellcheck source=./_cp.sh
source "$HERE/_cp.sh" || exit 1

JAVA="$JDK_DIR/bin/java.exe"
[ -x "$JAVA" ] || JAVA="$JDK_DIR/bin/java"
[ -x "$JAVA" ] || { echo "[FAIL] $JDK_DIR 下没有 java" >&2; exit 1; }

cd "$SERVER_ROOT" || exit 1

CLASSES="target/projects-probe"
rm -rf "$CLASSES" && mkdir -p "$CLASSES"

mapfile -t SRC < <(find src/main/java -name "*.java" | sort)
if [ "${#SRC[@]}" -eq 0 ]; then
  echo "[FAIL] src/main/java 下一个源文件都没有 —— 先确认源码树完好再跑探针" >&2
  exit 1
fi
SRC+=(".verify/ProjectsProbe.java")

if ! "$JAVAC" -encoding UTF-8 -nowarn -d "$CLASSES" -cp "$CP" "${SRC[@]}"; then
  echo "[FAIL] 探针编译失败（后端源码或 ProjectsProbe.java 有误）" >&2
  exit 1
fi

"$JAVA" -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -Dfile.encoding=UTF-8 \
  -cp "$(to_win "$SERVER_ROOT/$CLASSES");$CP" \
  ProjectsProbe "$(to_win "$OUT")" "${ACTIONS[@]}"
