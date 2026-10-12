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
    private static final Pattern REPLICAS = Pattern.compile("^\\s*replicas:\\s*(\\d+)");
    private static final Pattern REPLICA_COUNT = Pattern.compile("^\\s*replicaCount:\\s*(\\d+)");
    private static final Pattern UPSTREAM = Pattern.compile("^\\s*upstream\\s+(\\S+)\\s*\\{");
    private static final Pattern PROXY_PASS = Pattern.compile("proxy_pass\\s+https?://([^;\\s]+)");

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

    private static void scanCompose(ScanContext ctx, Path p, String rel, ArrayNode out) {
        List<String> lines = ctx.readLines(p);
        if (lines == null) return;
        ObjectNode n = ctx.mapper().createObjectNode();
        n.put("path", rel);
        ArrayNode services = n.putArray("services");
        boolean inServices = false;
        int servicesIndent = -1;
        Set<String> seen = new LinkedHashSet<>();
        for (String raw : lines) {
            if (raw.trim().isEmpty() || raw.trim().startsWith("#")) continue;
            int indent = raw.length() - raw.stripLeading().length();
            String t = raw.trim();
            if (t.startsWith("services:")) {
                inServices = true;
                servicesIndent = indent;
                continue;
            }
            if (inServices && indent <= servicesIndent && !t.isEmpty() && !t.startsWith("#")) {
                inServices = false;
                continue;
            }
            if (inServices && indent == servicesIndent + 2 && t.endsWith(":")) {
                seen.add(t.substring(0, t.length() - 1));
            }
        }
        seen.forEach(services::add);
        out.add(n);
    }

    private static void scanK8s(ScanContext ctx, Path p, String rel, ArrayNode out) {
        List<String> lines = ctx.readLines(p);
        if (lines == null) return;
        String kind = null, name = null;
        Integer replicas = null;
        for (String line : lines) {
            Matcher k = KIND.matcher(line);
            if (k.find() && kind == null) kind = k.group(1);
            if (kind != null && name == null) {
                Matcher nm = Pattern.compile("^\\s{0,4}name:\\s*(\\S+)").matcher(line);
                if (nm.find()) name = nm.group(1);
            }
            Matcher r = REPLICAS.matcher(line);
            if (r.find()) replicas = Integer.parseInt(r.group(1));
        }
        // kind 认不出来就不是 K8s 清单（可能只是普通 yaml），不硬凑
        if (kind == null) return;
        ObjectNode n = ctx.mapper().createObjectNode();
        n.put("path", rel);
        n.put("kind", kind);
        n.put("name", name);
        if (replicas == null) {
            n.putNull("replicas");
            ctx.warn(ScanNote.VALUE_MISSING, rel + " 里没有声明 replicas，副本数未知");
        } else {
            n.put("replicas", replicas);
        }
        out.add(n);
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
        }
        seen.forEach(upstreams::add);
        out.add(n);
    }
}
