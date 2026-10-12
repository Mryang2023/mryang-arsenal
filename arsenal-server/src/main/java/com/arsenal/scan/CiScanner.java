package com.arsenal.scan;

import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * CI 配置扫描：GitLab CI / GitHub Actions / Jenkins / Drone / Azure Pipelines。
 *
 * 只取「有哪些阶段 / 工作流叫什么」这一层，不解析 job 内部 ——
 * 那是流水线细节，不是架构事实。读不出来就留空数组，**不猜一个 [build, test, deploy]**。
 */
public final class CiScanner {

    private CiScanner() {
    }

    public static ArrayNode scan(ScanContext ctx) {
        ArrayNode out = ctx.mapper().createArrayNode();
        List<Path> files = new ArrayList<>();
        for (Path p : ctx.files()) {
            String rel = ctx.rel(p);
            String name = p.getFileName().toString().toLowerCase();
            if (name.equals(".gitlab-ci.yml") || name.equals(".gitlab-ci.yaml")
                    || name.equals("jenkinsfile") || name.equals(".drone.yml")
                    || name.equals("azure-pipelines.yml") || name.equals("Jenkinsfile")
                    || rel.contains(".github/workflows/")) {
                files.add(p);
            }
        }
        files.sort((a, b) -> ctx.rel(a).compareTo(ctx.rel(b)));

        for (Path p : files) {
            ctx.tick();
            String rel = ctx.rel(p);
            List<String> lines = ctx.readLines(p);
            if (lines == null) continue;
            ObjectNode n = ctx.mapper().createObjectNode();
            n.put("path", rel);
            ArrayNode stages = n.putArray("stages");
            String kind = "unknown";
            String name = null;

            if (rel.contains(".github/workflows/")) {
                kind = "github-actions";
            } else if (rel.contains(".gitlab-ci")) {
                kind = "gitlab-ci";
            } else if (rel.toLowerCase().contains("jenkinsfile")) {
                kind = "jenkins";
            } else if (rel.contains(".drone")) {
                kind = "drone";
            } else if (rel.contains("azure-pipelines")) {
                kind = "azure-pipelines";
            }
            n.put("kind", kind);

            boolean inStages = false;
            for (String raw : lines) {
                String t = raw.trim();
                if (t.isEmpty() || t.startsWith("#")) continue;
                if (name == null) {
                    if (t.startsWith("name:")) name = t.substring(5).trim().replace("\"", "");
                    else if (t.startsWith("pipeline")) name = "pipeline";
                }
                if (t.startsWith("stages:")) {
                    inStages = true;
                    // 同一行写法：stages: [build, test, deploy]
                    int b = t.indexOf('[');
                    if (b >= 0) {
                        String inner = t.substring(b + 1).replace("]", "");
                        for (String s : inner.split(",")) {
                            String v = s.trim().replace("\"", "").replace("'", "");
                            if (!v.isEmpty()) stages.add(v);
                        }
                        inStages = false;
                    }
                    continue;
                }
                if (inStages) {
                    if (t.startsWith("- ")) stages.add(t.substring(2).trim().replace("\"", ""));
                    else if (!t.startsWith("-")) inStages = false;
                }
            }
            if (name != null) n.put("name", name);
            if (stages.isEmpty()) {
                ctx.warn(ScanNote.VALUE_MISSING, rel + " 里没有解析出 stages —— 不猜默认值");
            }
            out.add(n);
        }
        return out;
    }
}
