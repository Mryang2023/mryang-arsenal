#!/usr/bin/env bash
#
# 运行时依赖类路径（被 runtime-probe.sh 用）。必须 source，不要直接执行。
#
# 为什么和 _cp.sh 分开：_cp.sh 的那份是**编译期**用的，注释里写得很清楚
# 「刻意不含运行期组件（tomcat 等）—— 静态校验要回答的是『API 用对了没』，不是『能不能跑起来』」。
# 活体解剖问的恰好是后者，所以单开一份，不把编译期的取舍偷偷改掉。
#
# 导出: RTCP（';' 拼接，可直接喂给 -cp）

M2_RT="${M2_REPO:-$HOME/.m2/repository}"
B=4.1.1
T=11.0.24

RTCP=""
RT_MISSING=()
_rt_add() {
  local p="$1" v="$2" a="$3"
  local f="$M2_RT/$p/$v/$a-$v.jar"
  if [ -f "$f" ]; then
    RTCP="$RTCP;$(to_win "$f")"
  else
    # 以前这里是一个光秃秃的 `if [ -f ]`：缺件既不进 RTCP 也不吭声。
    # 「由采集器如实报出」说的是 fixture 那一路（RuntimeClasspath 解析），
    # 但**这台跑探针的 JVM 自己**缺件时同样会 ClassNotFound，而读的人看不见清单
    # —— 与 r9 在 findJar() 里修的同一类病。攒起来在末尾一次性说到 stderr。
    RT_MISSING+=("$p:$a:$v")
  fi
}

# Spring Boot 4.x 家族（3.x 没有 web-server / http-converter 这些模块，
# 缺了不阻断拼装，但**必须在末尾说出来** —— 见 _rt_add 的 else 分支）
for a in spring-boot-jackson spring-boot-http-converter spring-boot-webmvc \
         spring-boot-servlet spring-boot-web-server spring-boot-tomcat \
         spring-boot-actuator spring-boot-actuator-autoconfigure spring-boot-health \
         spring-boot-micrometer-observation spring-boot-validation; do
  _rt_add "org/springframework/boot/$a" "$B" "$a"
done

for a in tomcat-embed-core tomcat-embed-el tomcat-embed-websocket; do
  _rt_add "org/apache/tomcat/embed/$a" "$T" "$a"
done

_rt_add io/micrometer/micrometer-observation 1.17.1 micrometer-observation
_rt_add io/micrometer/micrometer-commons 1.17.1 micrometer-commons
_rt_add io/micrometer/micrometer-core 1.17.1 micrometer-core
_rt_add ch/qos/logback/logback-classic 1.5.38 logback-classic
_rt_add ch/qos/logback/logback-core 1.5.38 logback-core
_rt_add org/apache/logging/log4j/log4j-to-slf4j 2.25.5 log4j-to-slf4j
_rt_add org/yaml/snakeyaml 2.6 snakeyaml
_rt_add jakarta/annotation/jakarta.annotation-api 3.0.0 jakarta.annotation-api
_rt_add jakarta/validation/jakarta.validation-api 3.1.1 jakarta.validation-api
_rt_add org/hibernate/validator/hibernate-validator 9.1.3.Final hibernate-validator
_rt_add org/jboss/logging/jboss-logging 3.6.3.Final jboss-logging
_rt_add com/fasterxml/classmate 1.7.3 classmate
_rt_add org/jspecify/jspecify 1.0.1 jspecify
_rt_add commons-logging/commons-logging 1.3.6 commons-logging
_rt_add tools/jackson/core/jackson-databind 3.1.5 jackson-databind
_rt_add tools/jackson/core/jackson-core 3.1.5 jackson-core
_rt_add com/fasterxml/jackson/core/jackson-annotations 2.21 jackson-annotations
_rt_add org/slf4j/slf4j-api 2.0.18 slf4j-api
_rt_add org/slf4j/jul-to-slf4j 2.0.18 jul-to-slf4j

# 缺件清单说到 stderr：stdout 要留给探针那份**单行 JSON**，混进去就把断言解挂了。
if [ "${#RT_MISSING[@]}" -gt 0 ]; then
  printf '[rtcp] 本机 .m2 缺 %d 个运行期构件（类路径按现有 jar 拼）：%s
'     "${#RT_MISSING[@]}" "$(IFS=' , '; echo "${RT_MISSING[*]}")" >&2
fi

export RTCP
