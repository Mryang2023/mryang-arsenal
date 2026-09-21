#!/usr/bin/env bash
#
# arsenal-server/scripts/archify-probe.sh —— 编译并运行出图服务探针
#
# 与 compile-check.sh 的区别：compile-check 只编译 src/main/java（产品代码），
# 这里额外把 .verify/ArchifyProbe.java 编进来 —— 它是校验工具，不该混进产品代码目录。
#
# 用法:
#   bash scripts/archify-probe.sh <outDir> <spec.json> [more.json ...]
#
# 通常不直接调用，由 arsenal-web/.verify/archify-check.ts 编排：
# 那边先生成 IR，再把这些 IR 交给这里实跑渲染。IR 必须来自前端真实产物，
# 不能在探针里自己造一份 —— 那样验的是探针造的输入，不是用户会拿到的那份。
#
# 可用环境变量覆盖：JDK_HOME、M2_REPO、ARSENAL_ARCHIFY_CLI、ARSENAL_ARCHIFY_NODE
#
# 退出码:
#   0  探针跑完（技能没装也算跑完 —— 那种情况收据里 available=false，由调用方判定要不要当失败）
#   1  编译失败或 java 起不来
#   2  参数不对
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"

if [ "$#" -lt 2 ]; then
  echo "用法: bash scripts/archify-probe.sh <outDir> <spec.json> [more.json ...]" >&2
  echo "  例: bash scripts/archify-probe.sh ./target/archify-probe ../arsenal-web/.verify/tmp/archify-check/00.json" >&2
  exit 2
fi

OUT_DIR="$1"
shift
SPECS=("$@")

mkdir -p "$OUT_DIR" || { echo "[FAIL] 无法创建输出目录：$OUT_DIR" >&2; exit 1; }

# shellcheck source=./_cp.sh
source "$HERE/_cp.sh" || exit 1

JAVA="$JDK_DIR/bin/java.exe"
[ -x "$JAVA" ] || JAVA="$JDK_DIR/bin/java"
[ -x "$JAVA" ] || { echo "[FAIL] $JDK_DIR 下没有 java" >&2; exit 1; }

cd "$SERVER_ROOT" || exit 1

CLASSES="target/archify"
rm -rf "$CLASSES" && mkdir -p "$CLASSES"

mapfile -t SRC < <(find src/main/java -name "*.java" | sort)
SRC+=(".verify/ArchifyProbe.java")

# 探针编译失败就是硬失败 —— 它是「页面上那颗按钮真的能用」这条承诺的守门人。
if ! "$JAVAC" -encoding UTF-8 -nowarn -d "$CLASSES" -cp "$CP" "${SRC[@]}"; then
  echo "[FAIL] 探针编译失败（后端源码或 ArchifyProbe.java 有误）" >&2
  exit 1
fi

# 传给 JVM 的路径必须转成 Windows 风格：漏转时 java 会把 /d/workspace/...
# 当成「当前盘根下的 d/workspace/...」，报「文件不存在」——
# 看起来像 IR 没生成，实则是路径风格问题。
SPECS_WIN=()
for s in "${SPECS[@]}"; do
  SPECS_WIN+=("$(to_win "$s")")
done

# sun.stdout.encoding 让探针的中文在 Windows 控制台可读，同时探针会把收据
# 按 UTF-8 写进文件 —— 两边都按 UTF-8，Node 侧读到的才不是一串问号。
"$JAVA" -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -Dfile.encoding=UTF-8 \
  -cp "$(to_win "$SERVER_ROOT/$CLASSES");$CP" \
  ArchifyProbe "$(to_win "$OUT_DIR")" "${SPECS_WIN[@]}"
