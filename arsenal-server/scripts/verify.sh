#!/usr/bin/env bash
#
# arsenal-server/scripts/verify.sh —— 服务端一键自检（无需 Maven，2026-10-25）
#
# 本机没有 mvn（见 compile-check.sh 头注），回归保护此前全靠手跑各探针 ——
# 「忘了跑」就是没跑。这个脚本把服务端能独立跑的三层收进一条命令：
#
#   ① compile-check.sh     全量 javac（语法 / API / 泛型 / lambda 捕获）
#   ② ast-probe.sh         AST 层 15 检查器实跑（对 arsenal-rules 真数据）
#   ③ projects-probe.sh    摄取安全四动作实跑（gate / overlap / quota / delete-deep，
#                          含 2026-10-18 递归复制事故的回归断言）
#
# parity / archify / scan / runtime 探针刻意不在这里重复编排 —— 它们的输入是
# 前端真实产物（导出物 / IR / 扫描请求），由 arsenal-web 的 verify 套件驱动：
#   cd ../arsenal-web && npm run verify
#
# 用法:
#   bash scripts/verify.sh
# 退出码:
#   0  三层全绿
#   1  任一层失败（失败层之前 passed 的层照常报告）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"
# 工作目录必须在 arsenal-server 目录树**之外**（ProjectsProbe.workDir 的安全网拒绝树内/祖先，
# 宁可不跑不删错）——放仓库根 /.verify/（.gitignore:50 已忽略），与 checkup-check 的用法同侧。
REPO_ROOT="$(dirname "$SERVER_ROOT")"
WORK="$REPO_ROOT/.verify/verify-work"
mkdir -p "$WORK"
# projects-probe 的动作参数要求 Windows 风格绝对路径（[A-Za-z]:/...，与
# checkup-check.ts 的 win() 转换同一约定）；Git Bash 下用 cygpath 转换。
if command -v cygpath >/dev/null 2>&1; then
  WORK_WIN="$(cygpath -m "$WORK")"
else
  WORK_WIN="$WORK"
fi

fail=0

run_step() {
  local name="$1"; shift
  echo ""
  echo "════ $name ════"
  if "$@"; then
    echo "── [OK] $name"
  else
    echo "── [FAIL] $name"
    fail=1
  fi
}

run_step "① 全量编译" bash "$HERE/compile-check.sh"

run_step "② AST 探针" bash "$HERE/ast-probe.sh" "$REPO_ROOT/arsenal-rules"

run_step "③ 摄取安全探针" bash "$HERE/projects-probe.sh" "$WORK_WIN/projects-probe.json" \
  "gate:$WORK_WIN/work-gate" \
  "overlap:$WORK_WIN/work-overlap" \
  "quota:$WORK_WIN/work-quota" \
  "delete-deep:$WORK_WIN/work-delete"

echo ""
if [ "$fail" -eq 0 ]; then
  echo "[VERIFY OK] 三层全绿。完整回归（含 parity / archify / scan）: cd ../arsenal-web && npm run verify"
else
  echo "[VERIFY FAIL] 有层失败，见上方输出"
fi
exit "$fail"
