ar#!/usr/bin/env bash
#
# arsenal-server 本地启动（无需 Maven）
#
# Why: 本机没有 mvn，但需要能真的把服务跑起来验证接口，
# 而不只是「编译通过」。用 JDK 21 + 本地 .m2 里的 Spring Boot 4.1.1 运行时依赖
# 直接 java 启动，够跑一个单体 Web 应用。
#
# 用法:
#   bash scripts/run.sh                 # 编译并启动
#   RUN_CWD=<dir> bash scripts/run.sh   # 指定工作目录（用于复现 CWD 相关的问题）
#   SKIP_COMPILE=1 bash scripts/run.sh  # 跳过编译，直接启动
#
# 可覆盖的环境变量:
#   JDK_HOME      JDK 21 安装目录（不含 /bin）
#   M2_REPO       本地 Maven 仓库
#   RUN_CWD       进程工作目录，默认 arsenal-server 自身
#   SERVER_ARGS   额外传给应用的参数
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"

# ── JDK 定位：不在这里写死，统一走 _cp.sh ───────────────────────
# 原先这行写死 C:/Users/Administrator/.jdks/ms-17.0.18。换一台机器、或 IDE 重装一次 JDK，
# 这个路径就失效，而报错只说「java not found under ...」——看不出是默认值过时了。
# `_cp.sh` 的注释里写着「各写一份的结果就是哪天换 JDK 只改了一处，另一处静默用旧路径，
# 正是本项目在防的那类漂移」—— run.sh 恰好就是没跟上那一份，已实测在本机直接启动失败。
# shellcheck source=./_cp.sh
source "$HERE/_cp.sh" || exit 1

JDKBIN="$JDK_DIR/bin"
M2="${M2_REPO:-C:/Users/Administrator/.m2/repository}"

# to_win 由 _cp.sh 提供（它那版是幂等的，能把「已是 D:\ 风格」的路径原样放过）。
JAVA="$JDKBIN/java.exe"
[ -x "$JAVA" ] || JAVA="$JDKBIN/java"

if [ ! -x "$JAVA" ]; then
  echo "[FAIL] java not found under: $JDKBIN  (JDK_DIR=$JDK_DIR)" >&2
  exit 1
fi

# 显式钉版本，不用「取最高版本」——
# 本机 .m2 里同时躺着 Spring Boot 2.2.6 与 3.2.5 两套，取最高版本偶然而非必然正确。
jar_of() {
  local p="$1" v="$2" a="$3"
  local f="$M2/$p/$v/$a-$v.jar"
  if [ -f "$f" ]; then
    echo "$f"
  else
    echo "[FAIL] 缺少依赖 $a:$v（应为 $f）" >&2
    echo "       本机无 Maven，无法自动下载。请在有 Maven 的机器执行 mvn -q dependency:go-offline" >&2
    exit 1
  fi
}

DEPS=(
  "org/springframework/boot/spring-boot:4.1.1:spring-boot"
  "org/springframework/boot/spring-boot-autoconfigure:4.1.1:spring-boot-autoconfigure"
  "org/springframework/boot/spring-boot-jackson:4.1.1:spring-boot-jackson"
  "org/springframework/boot/spring-boot-http-converter:4.1.1:spring-boot-http-converter"
  "org/springframework/boot/spring-boot-webmvc:4.1.1:spring-boot-webmvc"
  "org/springframework/boot/spring-boot-servlet:4.1.1:spring-boot-servlet"
  "org/springframework/spring-core:7.0.9:spring-core"
  "org/springframework/spring-beans:7.0.9:spring-beans"
  "org/springframework/spring-context:7.0.9:spring-context"
  "org/springframework/spring-aop:7.0.9:spring-aop"
  "org/springframework/spring-expression:7.0.9:spring-expression"
  "org/springframework/spring-web:7.0.9:spring-web"
  "org/springframework/spring-webmvc:7.0.9:spring-webmvc"
  "io/micrometer/micrometer-observation:1.17.1:micrometer-observation"
  "io/micrometer/micrometer-commons:1.17.1:micrometer-commons"
  "tools/jackson/core/jackson-databind:3.1.5:jackson-databind"
  "tools/jackson/core/jackson-core:3.1.5:jackson-core"
  "com/fasterxml/jackson/core/jackson-annotations:2.21:jackson-annotations"
  "commons-logging/commons-logging:1.3.6:commons-logging"
  "jakarta/validation/jakarta.validation-api:3.1.1:jakarta.validation-api"
  "jakarta/annotation/jakarta.annotation-api:3.0.0:jakarta.annotation-api"
  "org/hibernate/validator/hibernate-validator:9.1.3.Final:hibernate-validator"
  "org/jboss/logging/jboss-logging:3.6.3.Final:jboss-logging"
  "com/fasterxml/classmate:1.7.3:classmate"
  "org/jspecify/jspecify:1.0.1:jspecify"
  "org/slf4j/slf4j-api:2.0.18:slf4j-api"
  "ch/qos/logback/logback-classic:1.5.38:logback-classic"
  "ch/qos/logback/logback-core:1.5.38:logback-core"
  "org/apache/logging/log4j/log4j-to-slf4j:2.25.5:log4j-to-slf4j"
  "org/slf4j/jul-to-slf4j:2.0.18:jul-to-slf4j"
  "org/yaml/snakeyaml:2.6:snakeyaml"
  "org/apache/tomcat/embed/tomcat-embed-core:11.0.24:tomcat-embed-core"
  "org/apache/tomcat/embed/tomcat-embed-el:11.0.24:tomcat-embed-el"
  "org/apache/tomcat/embed/tomcat-embed-websocket:11.0.24:tomcat-embed-websocket"
)

CP=""
for spec in "${DEPS[@]}"; do
  path="${spec%%:*}"; rest="${spec#*:}"; ver="${rest%%:*}"; art="${rest##*:}"
  CP="$CP;$(to_win "$(jar_of "$path" "$ver" "$art")")"
done

cd "$SERVER_ROOT" || exit 1

mkdir -p target/classes

if [ "${SKIP_COMPILE:-0}" != "1" ]; then
  SOURCES=$(find src/main/java -name "*.java")
  echo "编译：$(echo "$SOURCES" | wc -l | tr -d ' ') 个源文件"
  if ! "$JAVAC" -encoding UTF-8 -nowarn -d target/classes -cp "${CP#;}" $SOURCES; then
    echo "[FAIL] 编译失败" >&2
    exit 1
  fi
fi

# 资源复制刻意留在 SKIP_COMPILE 之外：变量名的意思是「跳过编译」，不是「跳过资源」。
# 而且 compile-check.sh 只做静态校验、不复制资源，所以哪怕按最正常的顺序
# 「先 compile-check 再 SKIP_COMPILE=1 启动」也会缺 application.yml，
# 现象是 Spring 报 `Could not resolve placeholder 'arsenal.rules-dir'` ——
# 看着像配置写错，实则 target/classes 里只有 com/，配置文件根本没进去。
cp -r src/main/resources/. target/classes/

RUN_DIR="${RUN_CWD:-$SERVER_ROOT}"
mkdir -p "$RUN_DIR" 2>/dev/null
cd "$RUN_DIR" || exit 1

# ── 端口必须用命令行参数钉住，不能只靠 application.yml ──────────
#
# 踩过的坑：从托管环境（WorkBuddy / 某些 IDE 的终端）启动时，环境里会带着
# SERVER__PORT / SERVER__HOST —— 双下划线是 Spring 的「层级分隔」写法，
# relaxed binding 会把它认成 server.port，优先级**高于** application.yml。
# 现象是应用跑去抢宿主的端口，报「Port 3743 was already in use」；
# 报错指向端口，完全看不出是环境变量在作祟。
#
# 命令行参数的优先级高于环境变量，所以这一句能压过任何注入值。
# 需要换端口时用 ARSENAL_PORT，不要去改 application.yml。
PORT="${ARSENAL_PORT:-3011}"

echo "工作目录 : $(pwd)"
echo "启动     : com.arsenal.ArsenalApplication  (端口 ${PORT})"
echo ""

exec "$JAVA" -Dfile.encoding=UTF-8 -cp "$(to_win "$SERVER_ROOT/target/classes")${CP}" \
  com.arsenal.ArsenalApplication "--server.port=${PORT}" ${SERVER_ARGS:-}
