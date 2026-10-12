import com.arsenal.domain.Severity;
import com.arsenal.exporter.ExporterService;
import com.arsenal.loader.RuleIndex;
import com.arsenal.loader.RuleLoader;
import com.arsenal.mcp.McpToolCatalog;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 两端导出一致性探针（后端侧）。
 *
 * 这个文件不在 src/main/java 下 —— 它不是产品代码，是**校验工具**，
 * 所以 compile-check.sh 不会编译它，只有 parity-probe.sh 会。
 *
 * 它绕过 Spring，直接构造 RuleLoader → RuleIndex → ExporterService，
 * 把同一批过滤条件下的导出产物写到磁盘，由 arsenal-web/.verify/parity-check.ts
 * 与前端产物比对（markdown 逐字节、json 逐结构）。
 *
 * 存在的理由：「一份数据三种出口」是本项目的第一原则，而在这之前
 * **没有任何东西**能发现两端对同一个载体给出了不同答案 ——
 * json 曾经一边吐完整数组、一边吐 {count, ids}，就这样静默地漂了很久。
 *
 * <b>过滤条件由调用方通过命令行传入，不在这里写死。</b>
 * 早先这里自己写了一份 MUST/NEVER/SHOULD/MAY + 空分类，而前端用的是
 * MUST/NEVER/SHOULD + 九个分类，两者只是「当下恰好等价」（没有 MAY 规则的样本），
 * 哪天多一条 MAY 条目，探针就会开始比较两份不同的东西，而且不报错。
 * 现在由编排脚本把前端那份默认选项原样传进来，两边永远同一批参数。
 *
 * 用法：java -cp &lt;classes&gt;;&lt;deps&gt; ParityProbe &lt;rulesDir&gt; &lt;outDir&gt; &lt;severitiesCsv&gt; &lt;categoriesCsv&gt;
 */
public final class ParityProbe {

    private ParityProbe() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            System.err.println("用法: ParityProbe <rulesDir> <outDir> <severitiesCsv> <categoriesCsv>");
            System.err.println("  例: ParityProbe ./arsenal-rules ./out MUST,NEVER,SHOULD skeleton,web,service,...");
            System.exit(2);
        }
        Path rulesDir = Path.of(args[0]).toAbsolutePath().normalize();
        Path outDir = Path.of(args[1]).toAbsolutePath().normalize();
        Set<Severity> severities = parseSeverities(args[2]);
        Set<String> categories = parseCsv(args[3]);
        Files.createDirectories(outDir);

        ObjectMapper mapper = new ObjectMapper();
        RuleLoader loader = new RuleLoader(rulesDir.toString(), mapper);
        RuleIndex index = new RuleIndex(loader);
        McpToolCatalog mcpCatalog = new McpToolCatalog(loader, mapper);
        ExporterService exporter = new ExporterService(index, mapper, mcpCatalog);

        System.out.println("  过滤条件: severities=" + severities + "  categories=" + categories.size() + " 个");

        for (String format : new String[]{"json", "markdown", "mcp"}) {
            String content = exporter.export(format, severities, categories, true, true, false, false).content();
            Path out = outDir.resolve(format + ".txt");
            Files.writeString(out, content, StandardCharsets.UTF_8);
            System.out.println("  " + format + " → " + out.getFileName() + "（" + content.length() + " 字符）");
        }
    }

    /**
     * 级别解析。**未知级别直接失败**，不静默忽略 ——
     * 静默忽略的表现是「探针跑通了，只是少比了一部分规则」，
     * 那比不跑更危险。
     */
    private static Set<Severity> parseSeverities(String csv) throws Exception {
        Set<Severity> out = new LinkedHashSet<>();
        for (String raw : splitCsv(csv)) {
            try {
                out.add(Severity.valueOf(raw));
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("未知级别：" + raw + "（可选 MUST/NEVER/SHOULD/MAY）");
            }
        }
        return out;
    }

    private static Set<String> parseCsv(String csv) {
        Set<String> out = new LinkedHashSet<>(splitCsv(csv));
        return out;
    }

    private static List<String> splitCsv(String csv) {
        return List.of(csv.split(",")).stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
