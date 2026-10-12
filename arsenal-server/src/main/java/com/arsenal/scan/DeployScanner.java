package com.arsenal.scan;

import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 部署清单扫描：Dockerfile / compose / K8s / Helm / nginx。
 *
 * 与配置文件同理用逐行正则（要行号 + 不引 YAML 库）。
 * 一条硬规矩：<b>副本数读不到就是 null</b>。
 * 画三个副本框是因为清单里写了 {@code replicas: 3}，不是因为「一般都用三个」；
 * 读不到时图上标「未声明副本数」—— 编一个数字出来，交付文档会照抄。
 */
public final class DeployScanner {

    private static final Pattern FROM = Pattern.compile("^\\s*FROM\\s+(\\S+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern EXPOSE = Pattern.compile("^\\s*EXPOSE\\s+(\\d+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern KIND = Pattern.compile("^\\s*kind:\\s*(\\S+)");
    private static final Pattern NAME_K8S = Pattern.compile("^\\s{0,4}name:\\s*(\\S+)");
    private static final Pattern IMAGE_K8S = Pattern.compile("^\\s*image:\\s*(\\S+)");
    private static final Pattern REPLICAS = Pattern.compile("^\\s*replicas:\\s*(\\d+)");
    private static final Pattern REPLICA_COUNT = Pattern.compile("^\\s*replicaCount:\\s*(\\d+)");
    private static final Pattern UPSTREAM = Pattern.compile("^\\s*upstream\\s+(\\S+)\\s*\\{");
    private static final Pattern PROXY_PASS = Pattern.compile("proxy_pass\\s+https?://([^;\\s]+)");
    /** upstream 块内的 server 行（{@code server order-service:8081;}）—— 这里的 host 才是能与服务名匹配的 token */
    private static final Pattern NGINX_SERVER = Pattern.compile("^\\s*server\\s+([^;\\s]+);");

    private DeployScanner() {
    }

    public static ObjectNode scan(ScanContext ctx) {
        ObjectNode deploy = ctx.mapper().createObjectNode();
        ArrayNode dockerfiles = deploy.putArray("dockerfiles");
        ArrayNode compose = deploy.putArray("compose");
        ArrayNode k8s = deploy.putArray("k8s");
        ArrayNode helm = deploy.putArray("helm");
        ArrayNode nginx = deploy.putArray("nginx");

        for (Path p : sorted(ctx)) {
            ctx.tick();
            String rel = ctx.rel(p);
            String name = p.getFileName().toString().toLowerCase();

            if (name.equals("dockerfile") || name.startsWith("dockerfile.")) {
                scanDockerfile(ctx, p, rel, dockerfiles);
            } else if (name.contains("docker-compose") || name.contains("compose")) {
                scanCompose(ctx, p, rel, compose);
            } else if (name.equals("chart.yaml") || name.equals("values.yaml")) {
                scanHelm(ctx, p, rel, helm);
            } else if (name.endsWith(".yaml") || name.endsWith(".yml")) {
                scanK8s(ctx, p, rel, k8s);
            } else if (name.endsWith(".conf") && (rel.contains("nginx") || name.contains("nginx"))) {
                scanNginx(ctx, p, rel, nginx);
            }
        }
        return deploy;
    }

    private static List<Path> sorted(ScanContext ctx) {
        List<Path> out = new ArrayList<>();
        for (Path p : ctx.files()) {
            String n = p.getFileName().toString().toLowerCase();
            if (n.equals("dockerfile") || n.startsWith("dockerfile.") || n.endsWith(".yaml") || n.endsWith(".yml")
                    || n.endsWith(".conf") || n.contains("compose")) {
                out.add(p);
            }
        }
        out.sort((a, b) -> ctx.rel(a).compareTo(ctx.rel(b)));
        return out;
    }

    private static void scanDockerfile(ScanContext ctx, Path p, String rel, ArrayNode out) {
        List<String> lines = ctx.readLines(p);
        if (lines == null) return;
        ObjectNode n = ctx.mapper().createObjectNode();
        n.put("path", rel);
        ArrayNode images = n.putArray("baseImages");
        ArrayNode ports = n.putArray("exposedPorts");
        for (String line : lines) {
            Matcher f = FROM.matcher(line);
            if (f.find()) images.add(f.group(1));
            Matcher e = EXPOSE.matcher(line);
            if (e.find()) ports.add(Integer.parseInt(e.group(1)));
        }
        out.add(n);
    }

    /**
     * compose 服务清单。
     *
     * <p>{@code services} 名字数组保持原样（部署视角，既有消费方只认它），
     * 服务详情进 {@code serviceDetails}（服务视角，供 facts.services 摊平）——
     * 两边由本方法同一趟写出，不存在「改一处忘另一处」。
     *
     * <p>服务键的缩进**不写死 2 空格**：取 {@code services:} 之下出现的第一层缩进。
     * 写死 +2 的旧写法遇到 4 空格缩进的 compose 会得到空数组 ——
     * 而「compose 里没有服务」和「没解析出服务」在输出上长得一模一样。
     */
    private static void scanCompose(ScanContext ctx, Path p, String rel, ArrayNode out) {
        List<String> lines = ctx.readLines(p);
        if (lines == null) return;
        ObjectNode n = ctx.mapper().createObjectNode();
        n.put("path", rel);
        ArrayNode services = n.putArray("services");
        ArrayNode details = n.putArray("serviceDetails");
        Set<String> seen = new LinkedHashSet<>();
        int servicesIndent = -1;
        int serviceIndent = -1;
        ObjectNode cur = null;
        String listKey = null; // ports / depends_on 的块列表归属
        boolean inBuild = false;
        for (int i = 0; i < lines.size(); i += 1) {
            String raw = lines.get(i);
            String trimmed = raw.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
            int indent = raw.length() - raw.stripLeading().length();

            if (servicesIndent < 0) {
                if (trimmed.startsWith("services:")) {
                    servicesIndent = indent;
                    serviceIndent = -1;
                    cur = null;
                    listKey = null;
                    inBuild = false;
                }
                continue;
            }
            if (indent <= servicesIndent) {
                // services 段结束（顶层键或文件尾）
                servicesIndent = -1;
                cur = null;
                continue;
            }
            if (serviceIndent < 0) serviceIndent = indent;
            if (indent == serviceIndent) {
                inBuild = false;
                listKey = null;
                if (trimmed.endsWith(":")) {
                    String name = unquote(trimmed.substring(0, trimmed.length() - 1));
                    if (seen.add(name)) {
                        cur = details.addObject();
                        cur.put("name", name);
                        cur.put("line", i + 1);
                        cur.putNull("image");
                        cur.putNull("build");
                        cur.putNull("port");
                        cur.putArray("dependsOn");
                        services.add(name);
                    } else {
                        cur = null; // 重名键（非法 compose）不重复登记
                    }
                } else {
                    cur = null;
                }
                continue;
            }
            if (cur == null) continue;
            if (trimmed.startsWith("- ")) {
                String item = unquote(trimmed.substring(2).trim());
                if ("ports".equals(listKey)) {
                    applyPort(cur, item);
                } else if ("depends_on".equals(listKey) && !item.isEmpty()) {
                    ((ArrayNode) cur.get("dependsOn")).add(item);
                }
                continue;
            }
            int colon = trimmed.indexOf(':');
            if (colon <= 0) continue;
            String key = trimmed.substring(0, colon).trim();
            String val = trimmed.length() > colon + 1 ? unquote(trimmed.substring(colon + 1).trim()) : "";
            if (inBuild && "context".equals(key)) {
                if (!val.isEmpty()) cur.put("build", val);
                continue;
            }
            switch (key) {
                case "image" -> {
                    if (!val.isEmpty()) cur.put("image", val);
                    listKey = null;
                }
                case "build" -> {
                    if (!val.isEmpty()) {
                        cur.put("build", val);
                        inBuild = false;
                    } else {
                        inBuild = true; // 块式 build，等下面的 context:
                    }
                    listKey = null;
                }
                case "ports" -> {
                    listKey = "ports";
                    if (val.startsWith("[")) applyInlinePorts(cur, val);
                }
                case "depends_on" -> {
                    listKey = "depends_on";
                    if (val.startsWith("[")) applyInlineList((ArrayNode) cur.get("dependsOn"), val);
                }
                default -> {
                    listKey = null;
                    inBuild = false;
                }
            }
        }
        out.add(n);
    }

    /** 端口条目取**容器侧**：{@code 8080:8080} / {@code 127.0.0.1:8080:80} 都落到最后一个冒号之后 */
    private static void applyPort(ObjectNode service, String item) {
        int colon = item.lastIndexOf(':');
        String container = colon >= 0 ? item.substring(colon + 1).trim() : item.trim();
        if (service.path("port").isNumber()) return; // 只记第一个，不猜哪个是「主端口」
        try {
            service.put("port", Integer.parseInt(container));
        } catch (NumberFormatException e) {
            // 端口是变量（${PORT}:8080 的宿主侧常见）—— 解析不了就不写，不编
        }
    }

    private static void applyInlinePorts(ObjectNode service, String inline) {
        for (String item : splitInline(inline)) applyPort(service, item);
    }

    private static void applyInlineList(ArrayNode target, String inline) {
        for (String item : splitInline(inline)) {
            if (!item.isEmpty()) target.add(item);
        }
    }

    private static List<String> splitInline(String inline) {
        String inner = inline.trim();
        int lb = inner.indexOf('[');
        int rb = inner.lastIndexOf(']');
        if (lb >= 0 && rb > lb) inner = inner.substring(lb + 1, rb);
        List<String> out = new ArrayList<>();
        for (String part : inner.split(",")) {
            String v = unquote(part.trim());
            if (!v.isEmpty()) out.add(v);
        }
        return out;
    }

    private static String unquote(String v) {
        if (v.length() >= 2 && ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'")))) {
            return v.substring(1, v.length() - 1);
        }
        return v;
    }

    /**
     * K8s 清单扫描。<b>按 {@code ---} 切篇逐篇扫</b>。
     *
     * <p>旧写法整个文件只认第一个 {@code kind} —— 微服务仓库把十几个工作负载
     * 写进一个 all-in-one.yml 是常见写法，那样扫出来只有 1 条，
     * 「这个项目有几个服务」直接少一个数量级，而且**不报错**。
     * 单文档文件切出来还是一篇，行为与旧版一致。
     */
    private static void scanK8s(ScanContext ctx, Path p, String rel, ArrayNode out) {
        List<String> lines = ctx.readLines(p);
        if (lines == null) return;
        List<List<String>> docs = new ArrayList<>();
        List<Integer> docStart = new ArrayList<>();
        List<String> cur = new ArrayList<>();
        int curStart = 0;
        for (int i = 0; i < lines.size(); i += 1) {
            String line = lines.get(i);
            if (line.trim().equals("---")) {
                docs.add(cur);
                docStart.add(curStart);
                cur = new ArrayList<>();
                curStart = i + 1;
            } else {
                cur.add(line);
            }
        }
        docs.add(cur);
        docStart.add(curStart);

        for (int d = 0; d < docs.size(); d += 1) {
            List<String> doc = docs.get(d);
            int base = docStart.get(d);
            String kind = null, name = null, image = null;
            Integer replicas = null;
            int kindLine = 0;
            for (int i = 0; i < doc.size(); i += 1) {
                String line = doc.get(i);
                Matcher k = KIND.matcher(line);
                if (k.find() && kind == null) {
                    kind = k.group(1);
                    kindLine = base + i + 1; // 多文档时要能说清「哪一条出自哪一篇」
                }
                if (kind != null && name == null) {
                    Matcher nm = NAME_K8S.matcher(line);
                    if (nm.find()) name = nm.group(1);
                }
                Matcher im = IMAGE_K8S.matcher(line);
                if (im.find() && image == null) image = im.group(1);
                Matcher r = REPLICAS.matcher(line);
                if (r.find() && replicas == null) replicas = Integer.parseInt(r.group(1));
            }
            // kind 认不出来就不是 K8s 清单（可能只是普通 yaml），不硬凑
            if (kind == null) continue;
            ObjectNode n = ctx.mapper().createObjectNode();
            n.put("path", rel);
            n.put("kind", kind);
            n.put("line", kindLine);
            if (name != null) n.put("name", name);
            else n.putNull("name");
            // 镜像名是「这是应用还是基础设施」的判据（bitnami/redis:7 → redis）
            if (image != null) n.put("image", image);
            else n.putNull("image");
            if (replicas == null) {
                n.putNull("replicas");
                ctx.warn(ScanNote.VALUE_MISSING, rel + " 里没有声明 replicas，副本数未知");
            } else {
                n.put("replicas", replicas);
            }
            out.add(n);
        }
    }

    private static void scanHelm(ScanContext ctx, Path p, String rel, ArrayNode out) {
        List<String> lines = ctx.readLines(p);
        if (lines == null) return;
        ObjectNode n = ctx.mapper().createObjectNode();
        n.put("path", rel);
        String name = null;
        Integer replicaCount = null;
        for (String line : lines) {
            if (name == null) {
                Matcher nm = Pattern.compile("^name:\\s*(\\S+)").matcher(line);
                if (nm.find()) name = nm.group(1);
            }
            Matcher rc = REPLICA_COUNT.matcher(line);
            if (rc.find()) replicaCount = Integer.parseInt(rc.group(1));
        }
        n.put("name", name);
        if (replicaCount == null) n.putNull("replicaCount");
        else n.put("replicaCount", replicaCount);
        out.add(n);
    }

    private static void scanNginx(ScanContext ctx, Path p, String rel, ArrayNode out) {
        List<String> lines = ctx.readLines(p);
        if (lines == null) return;
        ObjectNode n = ctx.mapper().createObjectNode();
        n.put("path", rel);
        ArrayNode upstreams = n.putArray("upstreams");
        Set<String> seen = new LinkedHashSet<>();
        for (String line : lines) {
            Matcher u = UPSTREAM.matcher(line);
            if (u.find()) seen.add(u.group(1));
            Matcher pp = PROXY_PASS.matcher(line);
            if (pp.find()) seen.add(pp.group(1));
            // upstream 块里的 server 行：upstream 名（order_backend）匹配不上任何服务，
            // 它转发的 host（order-service:8081）才行 —— 少抓这一行，「谁在前面挡着」永远答不出来
            Matcher sv = NGINX_SERVER.matcher(line);
            if (sv.find()) seen.add(sv.group(1));
        }
        seen.forEach(upstreams::add);
        out.add(n);
    }
}
