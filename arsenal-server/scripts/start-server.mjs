#!/usr/bin/env node
/**
 * arsenal-server 本机常驻启动（node 版）
 *
 * Why: bash scripts/run.sh 在 MSYS 下的 exec 不是真 exec（fork + 等子进程），
 * 且交互式 harness 的 job object 会在命令结束时回收整棵进程树 ——
 * 表现为 java 每次打印完 "Started ArsenalApplication" 后 1~60 秒内静默死亡。
 * 本脚本由 node 直接 spawn 原生 java.exe，父 node 常驻不退出，
 * 命令不结束 → job object 不回收 → java 存活。退出时打印真实退出码/信号。
 *
 * 依赖清单与 scripts/run.sh 的 DEPS 保持一致（Boot 4.1.1 / Spring 7.0.9）。
 * 改版本时两处同步改。
 */
"use strict";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_ROOT = path.resolve(__dirname, "..");
const HOME = process.env.USERPROFILE || process.env.HOME;
const M2 = path.join(HOME, ".m2", "repository").replace(/\\/g, "/");

// ── JDK 21 定位（与 _cp.sh 同思路：扫 ~/.jdks 的 *21*） ──────────────
function findJdk() {
  const base = path.join(HOME, ".jdks");
  if (!fs.existsSync(base)) return null;
  for (const name of fs.readdirSync(base)) {
    if (!name.includes("21")) continue;
    const dir = path.join(base, name);
    if (fs.existsSync(path.join(dir, "bin", "java.exe"))) return dir;
  }
  return null;
}
const JDK = findJdk();
if (!JDK) {
  console.error("[FAIL] ~/.jdks 下找不到 JDK 21");
  process.exit(1);
}
const JAVA = path.join(JDK, "bin", "java.exe").replace(/\\/g, "/");

// ── 运行期依赖（与 run.sh DEPS 一致） ──────────────────────────────
const DEPS = [
  ["org/springframework/boot/spring-boot", "4.1.1", "spring-boot"],
  ["org/springframework/boot/spring-boot-autoconfigure", "4.1.1", "spring-boot-autoconfigure"],
  ["org/springframework/boot/spring-boot-jackson", "4.1.1", "spring-boot-jackson"],
  ["org/springframework/boot/spring-boot-http-converter", "4.1.1", "spring-boot-http-converter"],
  ["org/springframework/boot/spring-boot-webmvc", "4.1.1", "spring-boot-webmvc"],
  ["org/springframework/boot/spring-boot-servlet", "4.1.1", "spring-boot-servlet"],
  ["org/springframework/spring-core", "7.0.9", "spring-core"],
  ["org/springframework/spring-beans", "7.0.9", "spring-beans"],
  ["org/springframework/spring-context", "7.0.9", "spring-context"],
  ["org/springframework/spring-aop", "7.0.9", "spring-aop"],
  ["org/springframework/spring-expression", "7.0.9", "spring-expression"],
  ["org/springframework/spring-web", "7.0.9", "spring-web"],
  ["org/springframework/spring-webmvc", "7.0.9", "spring-webmvc"],
  ["io/micrometer/micrometer-observation", "1.17.1", "micrometer-observation"],
  ["io/micrometer/micrometer-commons", "1.17.1", "micrometer-commons"],
  ["tools/jackson/core/jackson-databind", "3.1.5", "jackson-databind"],
  ["tools/jackson/core/jackson-core", "3.1.5", "jackson-core"],
  ["com/fasterxml/jackson/core/jackson-annotations", "2.21", "jackson-annotations"],
  ["commons-logging/commons-logging", "1.3.6", "commons-logging"],
  ["jakarta/validation/jakarta.validation-api", "3.1.1", "jakarta.validation-api"],
  ["jakarta/annotation/jakarta.annotation-api", "3.0.0", "jakarta.annotation-api"],
  ["org/hibernate/validator/hibernate-validator", "9.1.3.Final", "hibernate-validator"],
  ["org/jboss/logging/jboss-logging", "3.6.3.Final", "jboss-logging"],
  ["com/fasterxml/classmate", "1.7.3", "classmate"],
  ["org/jspecify/jspecify", "1.0.1", "jspecify"],
  ["org/slf4j/slf4j-api", "2.0.18", "slf4j-api"],
  ["ch/qos/logback/logback-classic", "1.5.38", "logback-classic"],
  ["ch/qos/logback/logback-core", "1.5.38", "logback-core"],
  ["org/apache/logging/log4j/log4j-to-slf4j", "2.25.5", "log4j-to-slf4j"],
  ["org/slf4j/jul-to-slf4j", "2.0.18", "jul-to-slf4j"],
  ["org/yaml/snakeyaml", "2.6", "snakeyaml"],
  ["org/apache/tomcat/embed/tomcat-embed-core", "11.0.24", "tomcat-embed-core"],
  ["org/apache/tomcat/embed/tomcat-embed-el", "11.0.24", "tomcat-embed-el"],
  ["org/apache/tomcat/embed/tomcat-embed-websocket", "11.0.24", "tomcat-embed-websocket"],
];
const missing = DEPS.filter(([p, v, a]) => !fs.existsSync(`${M2}/${p}/${v}/${a}-${v}.jar`));
if (missing.length) {
  console.error("[FAIL] 缺少依赖: " + missing.map((m) => m[2]).join(", "));
  process.exit(1);
}
const CP = [
  SERVER_ROOT.replace(/\\/g, "/") + "/target/classes",
  ...DEPS.map(([p, v, a]) => `${M2}/${p}/${v}/${a}-${v}.jar`),
].join(";");

// 资源复制（与 run.sh 相同：SKIP_COMPILE 不含资源，缺 yml 会 resolve placeholder 失败）
const resSrc = path.join(SERVER_ROOT, "src/main/resources");
const resDst = path.join(SERVER_ROOT, "target/classes");
if (fs.existsSync(resSrc)) {
  for (const entry of fs.readdirSync(resSrc, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    fs.copyFileSync(path.join(resSrc, entry.name), path.join(resDst, entry.name));
  }
}

const PORT = process.env.ARSENAL_PORT || "3011";
console.log(`[start-server] JDK=${JDK}`);
console.log(`[start-server] 启动 com.arsenal.ArsenalApplication :${PORT}`);
const child = spawn(JAVA, ["-Dfile.encoding=UTF-8", "-cp", CP, "com.arsenal.ArsenalApplication", `--server.port=${PORT}`], {
  cwd: SERVER_ROOT,
  stdio: ["ignore", "inherit", "inherit"],
});
child.on("exit", (code, signal) => {
  console.log(`[start-server] java 退出 code=${code} signal=${signal}`);
  process.exit(code == null ? 1 : code);
});
// 父 node 常驻：不退出，命令就不结束，harness 的 job object 不会回收 java
setInterval(() => {}, 60000);
