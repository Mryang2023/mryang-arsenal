#!/usr/bin/env bash
#
# arsenal-server 静态编译校验（无需 Maven）
#
# Why: 本机没有 mvn，但仍需要确定性地回答「这套代码能不能编译」。
# 用 JDK 17 + 本地 .m2 里已有的 Spring Boot 3.2.5 依赖跑 javac，
# 能抓住语法错误、API 误用、泛型不匹配、lambda 捕获等问题。
#
# 用法:
#   bash scripts/compile-check.sh
# 可覆盖的环境变量:
#   JDK_HOME   JDK 17 安装目录（不含 /bin）
#   M2_REPO    本地 Maven 仓库
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(dirname "$HERE")"

JDKBIN="${JDK_HOME:-C:/Users/Administrator/.jdks/ms-17.0.18}/bin"
M2="${M2_REPO:-C:/Users/Administrator/.m2/repository}"

# Windows 版 javac 只认 Windows 风格路径（C:/...），不认 Git Bash 的 /c/...
to_win() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

JAVAC="$JDKBIN/javac.exe"
if [ ! -x "$JAVAC" ]; then
  JAVAC="$JDKBIN/javac"
fi
if [ ! -x "$JAVAC" ]; then
  echo "[FAIL] javac not found under: $JDKBIN" >&2
  echo "       set JDK_HOME to a JDK 17 installation directory" >&2
  exit 1
fi

# 取指定 artifact 的最高版本 jar
pick() {
  find "$M2/$1" -name "$2-*.jar" 2>/dev/null \
    | grep -v sources | grep -v javadoc | sort -V | tail -1
}

# 编译期真正需要的依赖。刻意不含运行期组件（tomcat 等）——
# 静态校验要回答的是「API 用对了没」，不是「能不能跑起来」。
DEPS=(
  "org/springframework/boot/spring-boot:spring-boot"
  "org/springframework/boot/spring-boot-autoconfigure:spring-boot-autoconfigure"
  "org/springframework/spring-core:spring-core"
  "org/springframework/spring-beans:spring-beans"
  "org/springframework/spring-context:spring-context"
  "org/springframework/spring-aop:spring-aop"
  "org/springframework/spring-expression:spring-expression"
  "org/springframework/spring-jcl:spring-jcl"
  "org/springframework/spring-web:spring-web"
  "org/springframework/spring-webmvc:spring-webmvc"
  "com/fasterxml/jackson/core/jackson-databind:jackson-databind"
  "com/fasterxml/jackson/core/jackson-core:jackson-core"
  "com/fasterxml/jackson/core/jackson-annotations:jackson-annotations"
  "jakarta/validation/jakarta.validation-api:jakarta.validation-api"
  "jakarta/annotation/jakarta.annotation-api:jakarta.annotation-api"
  "org/slf4j/slf4j-api:slf4j-api"
)

CP=""
MISSING=0
for spec in "${DEPS[@]}"; do
  d="${spec%%:*}"; a="${spec##*:}"
  jar=$(pick "$d" "$a")
  if [ -z "$jar" ]; then
    echo "  [MISSING] $a" >&2
    MISSING=1
  else
    CP="$CP;$(to_win "$jar")"
  fi
done

if [ "$MISSING" -ne 0 ]; then
  echo "" >&2
  echo "本地 .m2 依赖不全，无法静态校验。请在有 Maven 的机器执行: mvn -q compile" >&2
  exit 1
fi

cd "$SERVER_ROOT" || exit 1

SOURCES=$(find src/main/java -name "*.java")
COUNT=$(echo "$SOURCES" | wc -l | tr -d ' ')

mkdir -p target/classes

echo "JDK    : $("$JAVAC" -version 2>&1)"
echo "Sources: $COUNT files"
echo "Output : $SERVER_ROOT/target/classes"
echo ""

if "$JAVAC" -encoding UTF-8 -nowarn -d target/classes -cp "${CP#;}" $SOURCES; then
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
