#!/usr/bin/env bash
#
# arsenal-server/scripts/_cp.sh —— JDK 定位 + 依赖类路径（被 compile-check.sh / parity-probe.sh 共用）
#
# 为什么单独一个文件：两个脚本都要「找到 javac、拼出 .m2 里的 jar 列表」。
# 各写一份的结果就是哪天换 JDK 只改了一处，另一处静默用旧路径 —— 正是本项目在防的那类漂移。
#
# 用法（必须 source，不要直接执行）：
#   source "$(dirname "$0")/_cp.sh" || exit 1
# 导出的变量：
#   JAVAC    javac 可执行文件（Windows 风格路径可用）
#   CP       依赖类路径（已用 ';' 拼接，可直接传给 -cp）
#   M2       本地 Maven 仓库
#
# 可用环境变量覆盖：JDK_HOME（JDK 安装目录，不含 /bin）、M2_REPO

# ── JDK 定位 ──────────────────────────────────────────────────
# 早先这里写死 C:/Users/Administrator/.jdks/ms-17.0.18 —— 换一台机器/换一次
# IDE 装的 JDK，这个路径就失效，而报错只说「javac not found」，看不出是默认值过时了。
# 现在按候选列表依次找，并且把「找过哪些」写进报错。
_jdk_candidates() {
  if [ -n "${JDK_HOME:-}" ]; then
    printf '%s\n' "$JDK_HOME"
    return
  fi
  # 显式指定优先；否则扫 .jdks 与常见安装位置，取最高的 17
  for base in "$HOME/.jdks" "/c/Program Files/Java" "/c/Program Files/Eclipse Adoptium" \
              "/c/Program Files/Microsoft" "/c/Program Files/Amazon Corretto" "/c/Program Files/Zulu"; do
    [ -d "$base" ] || continue
    ls -d "$base"/*17* 2>/dev/null
    ls -d "$base"/jdk-17* 2>/dev/null
  done
  # 兜底：JAVA_HOME 里就是 17 的话也能用
  [ -n "${JAVA_HOME:-}" ] && printf '%s\n' "$JAVA_HOME"
}

JDK_DIR=""
while IFS= read -r cand; do
  [ -n "$cand" ] || continue
  if [ -x "$cand/bin/javac.exe" ] || [ -x "$cand/bin/javac" ]; then
    JDK_DIR="$cand"
    break
  fi
done <<EOF
$(_jdk_candidates)
EOF

if [ -z "$JDK_DIR" ]; then
  echo "[FAIL] 找不到可用的 JDK 17。" >&2
  echo "       试过的位置：" >&2
  _jdk_candidates | sed 's/^/         - /' >&2
  echo "       指定方式：JDK_HOME=<JDK 安装目录> bash <脚本>" >&2
  return 1 2>/dev/null || exit 1
fi

JAVAC="$JDK_DIR/bin/javac.exe"
[ -x "$JAVAC" ] || JAVAC="$JDK_DIR/bin/javac"
[ -x "$JAVAC" ] || { echo "[FAIL] $JDK_DIR 下没有 javac" >&2; return 1 2>/dev/null || exit 1; }

# ── .m2 类路径 ────────────────────────────────────────────────
M2="${M2_REPO:-$HOME/.m2/repository}"

# Windows 版 javac / java 只认 Windows 风格路径（C:/...），不认 Git Bash 的 /c/...。
# 幂等：已经是 Windows 路径就直接返回 —— 否则 cygpath 会把 D:\x 二次转成 D:/D:/x，
# 那种错的表现是「目录不存在」，和真正的路径写错长得一模一样，极难定位。
to_win() {
  case "$1" in
    [A-Za-z]:[\\/]*) printf '%s' "$1"; return ;;
  esac
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

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
  return 1 2>/dev/null || exit 1
fi

CP="${CP#;}"
export JAVAC CP M2 JDK_DIR
