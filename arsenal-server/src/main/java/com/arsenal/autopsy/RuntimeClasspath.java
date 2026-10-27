package com.arsenal.autopsy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 无 Maven 环境下的运行时类路径解析。
 *
 * <p><b>为什么需要它</b>：本机没有 {@code mvn}（探活实测 command not found），
 * 而活体解剖要把项目真跑起来 —— 没有类路径就跑不起来。
 *
 * <p><b>为什么不是写死一张版本表</b>：写死等于把「Boot 4.1.1 配 Spring 7.0.9」这条事实
 * 抄进代码里，抄错的那一天（升级 Boot）只会表现为「莫名其妙起不来」，
 * 而报错指向 ClassNotFound，完全看不出是版本表过期。
 * 所以这里<b>从项目自己的 pom + Spring Boot 的 BOM 里读版本</b> ——
 * BOM 是官方那一份，不是我们猜的那一份。
 *
 * <p>解析顺序：
 * <ol>
 *   <li>项目 {@code pom.xml} → Spring Boot 版本（parent 或属性）</li>
 *   <li>{@code spring-boot-dependencies-<v>.pom} → {@code <spring-framework.version>} /
 *       {@code <tomcat.version>} / {@code <micrometer.version>} …</li>
 *   <li>BOM 里没有的属性 → 取本地 .m2 里该 artifact 的最高版本（与 {@code scripts/_cp.sh} 同款做法）</li>
 * </ol>
 * 缺哪个 jar 就写进 {@link Resolved#missing()}，由调用方如实报「缺依赖」，不许静默少传一个。
 */
public final class RuntimeClasspath {

    /** 缺了就跑不起来的最小集 —— 少一个都必须说 not-run，不许「先跑跑看」 */
    private static final List<Spec> REQUIRED = List.of(
            new Spec("org/springframework/boot", "spring-boot", "boot"),
            new Spec("org/springframework/boot", "spring-boot-autoconfigure", "boot"),
            new Spec("org/springframework", "spring-core", "spring-framework"),
            new Spec("org/springframework", "spring-beans", "spring-framework"),
            new Spec("org/springframework", "spring-context", "spring-framework"),
            new Spec("org/springframework", "spring-aop", "spring-framework"),
            new Spec("org/springframework", "spring-expression", "spring-framework"),
            new Spec("org/springframework", "spring-web", "spring-framework"),
            new Spec("org/springframework", "spring-webmvc", "spring-framework"),
            new Spec("org/slf4j", "slf4j-api", "slf4j"));

    /**
     * 有了更好、没有也先跑跑看的（Boot 各代的模块划分不一样：
     * 4.x 的 spring-boot-web-server / http-converter 在 3.x 里根本不存在）。
     * 缺了不阻断，但会记进 missing —— 「为什么起不来」要能回答。
     */
    private static final List<Spec> OPTIONAL = List.of(
            new Spec("org/springframework/boot", "spring-boot-jackson", "boot"),
            new Spec("org/springframework/boot", "spring-boot-http-converter", "boot"),
            new Spec("org/springframework/boot", "spring-boot-webmvc", "boot"),
            new Spec("org/springframework/boot", "spring-boot-servlet", "boot"),
            new Spec("org/springframework/boot", "spring-boot-web-server", "boot"),
            new Spec("org/springframework/boot", "spring-boot-tomcat", "boot"),
            new Spec("org/springframework/boot", "spring-boot-actuator", "boot"),
            new Spec("org/springframework/boot", "spring-boot-actuator-autoconfigure", "boot"),
            new Spec("org/springframework/boot", "spring-boot-health", "boot"),
            new Spec("org/springframework/boot", "spring-boot-micrometer-observation", "boot"),
            new Spec("org/springframework/boot", "spring-boot-validation", "boot"),
            new Spec("org/springframework", "spring-jcl", "spring-framework"),
            new Spec("org/springframework", "spring-tx", "spring-framework"),
            new Spec("org/apache/tomcat/embed", "tomcat-embed-core", "tomcat"),
            new Spec("org/apache/tomcat/embed", "tomcat-embed-el", "tomcat"),
            new Spec("org/apache/tomcat/embed", "tomcat-embed-websocket", "tomcat"),
            new Spec("io/micrometer", "micrometer-observation", "micrometer"),
            new Spec("io/micrometer", "micrometer-commons", "micrometer"),
            new Spec("io/micrometer", "micrometer-core", "micrometer"),
            new Spec("tools/jackson/core", "jackson-databind", "jackson-bom"),
            new Spec("tools/jackson/core", "jackson-core", "jackson-bom"),
            new Spec("com/fasterxml/jackson/core", "jackson-annotations", "highest"),
            new Spec("commons-logging", "commons-logging", "highest"),
            new Spec("jakarta/annotation", "jakarta.annotation-api", "highest"),
            new Spec("jakarta/validation", "jakarta.validation-api", "highest"),
            new Spec("org/hibernate/validator", "hibernate-validator", "hibernate-validator"),
            new Spec("org/jboss/logging", "jboss-logging", "highest"),
            new Spec("com/fasterxml", "classmate", "highest"),
            new Spec("org/jspecify", "jspecify", "highest"),
            new Spec("ch/qos/logback", "logback-classic", "logback"),
            new Spec("ch/qos/logback", "logback-core", "logback"),
            new Spec("org/apache/logging/log4j", "log4j-to-slf4j", "highest"),
            new Spec("org/slf4j", "jul-to-slf4j", "slf4j"),
            new Spec("org/yaml", "snakeyaml", "snakeyaml"));

    private static final Pattern PARENT_VERSION = Pattern.compile(
            "<parent>.*?<artifactId>spring-boot-(?:starter-parent|dependencies)</artifactId>.*?<version>([^<]+)</version>",
            Pattern.DOTALL);
    private static final Pattern PROP = Pattern.compile("<([A-Za-z0-9._-]+)\\.version>\\s*([^<]+?)\\s*</");
    private static final Pattern TAG = Pattern.compile("<([A-Za-z0-9._-]+)>\\s*([^<]+?)\\s*</\\1>");

    private RuntimeClasspath() {
    }

    /** 一条依赖坐标 + 它的版本该去哪儿找 */
    public record Spec(String groupPath, String artifact, String versionKey) {
    }

    /**
     * @param jars      解析到的 jar（Windows 风格路径，可直接拼 -cp）
     * @param missing   解析不到的坐标（"groupId:artifactId"），调用方必须如实报出去
     * @param bootVersion 从项目 pom 读到的 Boot 版本；读不到是 null
     * @param note      为什么这么解析 / 哪里降级了，原样给用户看
     */
    public record Resolved(List<String> jars, List<String> missing, String bootVersion, String note) {
    }

    public static Resolved resolve(Path projectDir, Path m2Repo) {
        List<String> missing = new ArrayList<>();
        StringBuilder note = new StringBuilder();

        Path pom = projectDir.resolve("pom.xml");
        if (!Files.isRegularFile(pom)) {
            return new Resolved(List.of(), List.of("pom.xml"), null,
                    "项目根下没有 pom.xml —— 本环境无 mvn，只支持「从 pom + .m2 平铺解析」这一条路，"
                            + "没有 pom 就无从知道依赖版本（不是「没有依赖」）");
        }

        String pomText;
        try {
            pomText = Files.readString(pom);
        } catch (IOException e) {
            return new Resolved(List.of(), List.of("pom.xml"), null, "pom.xml 读不出来：" + e.getMessage());
        }
        String boot = readBootVersion(pomText);
        if (boot == null) {
            return new Resolved(List.of(), List.of("spring-boot-version"), null,
                    "pom.xml 里读不到 Spring Boot 版本（既没有 spring-boot-starter-parent，"
                            + "也没有 spring-boot.version 属性）—— 猜一个版本去跑，跑不起来就分不清是版本错还是项目错");
        }

        Map<String, String> props = readBomProperties(m2Repo, boot, note);
        List<String> jars = new ArrayList<>();
        List<String> downgraded = new ArrayList<>();
        for (Spec s : REQUIRED) {
            Path jar = findJar(m2Repo, s, boot, props, downgraded);
            if (jar == null) missing.add(s.groupPath().replace('/', '.') + ":" + s.artifact());
            else jars.add(jar.toString());
        }
        for (Spec s : OPTIONAL) {
            Path jar = findJar(m2Repo, s, boot, props, downgraded);
            if (jar == null) missing.add(s.groupPath().replace('/', '.') + ":" + s.artifact() + "(可选)");
            else jars.add(jar.toString());
        }
        // 降过版本的那些坐标同样记进 missing —— 「缺 4.1.1」和「完全没装」都得让用户看见，
        // 区别只在后缀：前者是混版（能凑出 42 个 jar、真跑起来才炸），后者是压根没有。
        if (!downgraded.isEmpty()) {
            downgraded.forEach(missing::add);
            note.append("其中 ").append(downgraded.size())
                    .append(" 个构件按 pom 要的版本在本地 .m2 没有，已退到本地最高版本（混版跑，可能启动即崩）：")
                    .append(String.join(" / ", downgraded)).append("。");
        }
        return new Resolved(jars, missing, boot, note.toString());
    }

    private static String readBootVersion(String pomText) {
        Matcher m = PARENT_VERSION.matcher(pomText);
        if (m.find()) return m.group(1).trim();
        for (String key : new String[]{"spring-boot.version", "spring.boot.version", "boot.version"}) {
            Matcher p = Pattern.compile("<" + Pattern.quote(key) + ">\\s*([^<]+?)\\s*</").matcher(pomText);
            if (p.find()) return p.group(1).trim();
        }
        // 依赖里直接写了 spring-boot-starter-web:<v> 也算数
        Matcher dep = Pattern.compile(
                "<artifactId>spring-boot-starter-[a-z-]+</artifactId>\\s*<version>\\s*([^<]+?)\\s*</version>")
                .matcher(pomText);
        if (dep.find()) return dep.group(1).trim();
        return null;
    }

    /** 从 spring-boot-dependencies-<v>.pom 里抄官方那张版本表 */
    private static Map<String, String> readBomProperties(Path m2Repo, String boot, StringBuilder note) {
        Map<String, String> props = new LinkedHashMap<>();
        Path bom = m2Repo.resolve("org/springframework/boot/spring-boot-dependencies")
                .resolve(boot).resolve("spring-boot-dependencies-" + boot + ".pom");
        if (!Files.isRegularFile(bom)) {
            note.append("本地 .m2 里没有 spring-boot-dependencies:").append(boot)
                    .append("，版本改走「取该 artifact 最高可用版」—— 可能与项目真实依赖不一致。");
            return props;
        }
        try {
            String text = Files.readString(bom);
            Matcher m = PROP.matcher(text);
            while (m.find()) {
                props.putIfAbsent(m.group(1).toLowerCase(Locale.ROOT), m.group(2).trim());
            }
        } catch (IOException e) {
            note.append("BOM 读不出来：").append(e.getMessage()).append("。");
        }
        return props;
    }

    private static Path findJar(Path m2Repo, Spec s, String boot, Map<String, String> props,
                                List<String> downgraded) {
        Path dir = m2Repo.resolve(s.groupPath()).resolve(s.artifact());
        if (!Files.isDirectory(dir)) return null;
        String want = switch (s.versionKey()) {
            case "boot" -> boot;
            case "highest" -> null;
            default -> props.get(s.versionKey());
        };
        if (want != null) {
            Path exact = dir.resolve(want).resolve(s.artifact() + "-" + want + ".jar");
            if (Files.isRegularFile(exact)) return exact;
        }
        // 退到「该 artifact 在 .m2 里的最高版本」。这一步是不精确的，但比直接放弃好 ——
        // 前提是它**必须被说出来**：注释一旦宣称「记进 note」而代码没记，读报错的人就会被
        // 带偏成「缺构件」（2026-10-27 r9 实测：actuator-autoconfigure 退到 3.3.6 混进
        // 4.1.1 家族，崩在 Spring 的 condition 上，missingDeps 却只报了另外两个真缺的）。
        try (var walk = Files.list(dir)) {
            Path fallback = walk.filter(Files::isDirectory)
                    .sorted(RuntimeClasspath::compareDirNamesDesc)
                    .map(v -> v.resolve(s.artifact() + "-" + v.getFileName() + ".jar"))
                    .filter(Files::isRegularFile)
                    .findFirst()
                    .orElse(null);
            if (fallback != null && want != null
                    && !fallback.getFileName().toString().equals(s.artifact() + "-" + want + ".jar")) {
                downgraded.add(s.groupPath().replace('/', '.') + ":" + s.artifact()
                        + "(" + want + " 未装，退到 " + fallback.getParent().getFileName() + ")");
            }
            return fallback;
        } catch (IOException e) {
            return null;
        }
    }

    /** 目录名倒序（版本号当字符串排，够用：4.1.1 > 3.5.16 > 3.2.12） */
    private static int compareDirNamesDesc(Path a, Path b) {
        return b.getFileName().toString().compareTo(a.getFileName().toString());
    }
}
