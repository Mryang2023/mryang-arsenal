#!/usr/bin/env bash
#
# 活体解剖探针（无需 Maven）：编译 + 真跑一个项目，把运行时事实以 JSON 打到 stdout。
#
# Why: 断言层不能依赖 3011 后端活着 —— 后端要是起不来，「沙箱杀没杀干净」这条
# 安全红线就没人守了。所以给 RuntimeProbe 开一条 CLI 入口，断言直接 spawn 它。
# 与 POST /api/autopsy/run 共用同一个 RuntimeProbe.probe，不是第二份实现。
#
# 用法:
#   bash scripts/runtime-probe.sh <项目目录> <主类名> [runtime] [墙钟ms] [相对工作目录]
#
# 例:
#   bash scripts/runtime-probe.sh ../.verify/fixtures/runtime-demo demo.DemoApplication
#   bash scripts/runtime-probe.sh ../.verify/fixtures/runtime-broken demo.BrokenApplication spring-boot 30000
#
# 可覆盖: JDK_HOME / M2_REPO
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"

# JDK 定位与编译期依赖，跟 compile-check.sh / parity-probe.sh 走同一份（换 JDK 只改一处）
# shellcheck source=./_cp.sh
source "$HERE/_cp.sh" || exit 1

M2="${M2_REPO:-$HOME/.m2/repository}"

# to_win 只能吃**单条**路径 —— 喂一整串带 ';' 的类路径给它，cygpath 会原样吐回一个
# 拼在一起的字符串，现象是 ClassNotFoundException 且看不出是路径没转。
# 所以这里逐段转：CP / RTCP 里的 jar 已经各自转过，只补 SERVER_ROOT 这一段。
CPALL="$(to_win "$SERVER_ROOT")/target/classes;${CP}"

# 运行时依赖：_cp.sh 只给编译期那一小撮（刻意不含 tomcat），
# 真跑起来还需要 web / actuator / tomcat / 日志这几组。
if [ -f "$HERE/_rtcp.sh" ]; then
  # shellcheck source=./_rtcp.sh
  source "$HERE/_rtcp.sh" || exit 1
  CPALL="$CPALL;${RTCP#;}"
fi

exec "$JDK_DIR/bin/java" -Dfile.encoding=UTF-8 -cp "$CPALL" \
  com.arsenal.autopsy.RuntimeProbe "$@"
