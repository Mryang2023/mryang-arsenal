package com.arsenal.engine;

import com.arsenal.domain.Rule;
import com.sun.source.tree.*;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.Trees;
import com.sun.source.util.TreeScanner;
import org.springframework.stereotype.Component;

import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiFunction;

/**
 * Level 1b 校验引擎（语法树层）。
 *
 * 用 JDK 自带的 {@code jdk.compiler}（JavacTask + TreeScanner）做 AST 解析 ——
 * <b>零新增依赖</b>，不需要 JavaParser。它补的是正则做不了、但语法层面就能确定的那部分：
 * 字段注入、显式 new Thread、空 catch、finally 里 return、@Transactional 缺 rollbackFor 等。
 *
 * <b>诚实边界（沿用「不伪造判定」的原则）：</b>
 * 只实现「语法层高置信」的检查器。需要类型解析 / 跨文件符号表 / 控制流分析的
 * （例如「缺少 @Override 但确实重写了父类方法」「ThreadLocal 的 set 在 finally 里没 remove」），
 * 这里<b>不注册检查器</b>，于是那条规则仍由 LintEngine 如实归入 skipped，
 * 等真正的语义/类型层（JavaParser + 符号表，或 LLM）来收。宁可说检不了，也不给假阳性。
 *
 * 行号来自 {@link SourcePositions}（而非 Tree 自带偏移，Tree 接口不暴露位置），
 * 再换算成行号 —— 命中必须能定位到行，这是「给出结论」的底线。
 */
@Component
public final class AstEngine {

    /** 一条 AST 命中。行号由 SourcePositions 偏移换算，不依赖行号猜测。 */
    public record Finding(String ruleId, int line, String message, String snippet) {
    }

    /** 源码包装：提供「字符偏移 → 行号 / 行片段」。 */
    public static final class SourceText {
        private final String text;
        private final int[] newlines;

        SourceText(String text) {
            this.text = text;
            int n = 0;
            for (int i = 0; i < text.length(); i++) {
                if (text.charAt(i) == '\n') {
                    n++;
                }
            }
            this.newlines = new int[n];
            int k = 0;
            for (int i = 0; i < text.length(); i++) {
                if (text.charAt(i) == '\n') {
                    this.newlines[k++] = i;
                }
            }
        }

        int lineOf(long pos) {
            if (pos < 0) {
                return 1;
            }
            int lo = 0;
            int hi = newlines.length;
            while (lo < hi) {
                int mid = (lo + hi) >>> 1;
                if (newlines[mid] < pos) {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            return lo + 1;
        }

        String snippetAt(long pos, int max) {
            int p = (int) Math.max(0, pos);
            int lineStart = text.lastIndexOf('\n', p) + 1;
            int lineEnd = text.indexOf('\n', p);
            if (lineEnd < 0) {
                lineEnd = text.length();
            }
            String s = text.substring(lineStart, Math.max(lineStart, lineEnd)).trim();
            return s.length() > max ? s.substring(0, max) + "…" : s;
        }
    }

    /** 一次扫描的上下文：编译单元、源码包装、位置表。检查器只读它，不自己再 parse。 */
    private record ScanCtx(CompilationUnitTree cut, SourceText src, SourcePositions pos) {
    }

    @FunctionalInterface
    private interface Checker {
        List<Finding> check(Rule rule, ScanCtx ctx);
    }

    private final Map<String, Checker> checkers = new HashMap<>();

    public AstEngine() {
        register();
    }

    /** 该 AST 规则是否有可执行的检查器（没有就应当留在 skipped）。 */
    public boolean hasChecker(String ruleId) {
        return checkers.containsKey(ruleId);
    }

    public List<Finding> lint(Rule rule, String filename, String content) {
        if (!hasChecker(rule.id())) {
            return List.of();
        }
        Parsed parsed = parse(filename, content);
        if (parsed == null) {
            return List.of();
        }
        ScanCtx ctx = new ScanCtx(parsed.cut(), new SourceText(content), parsed.pos());
        return checkers.get(rule.id()).check(rule, ctx);
    }

    /**
     * 对单个文件解析一次（避免每条规则重复 parse），跑完全部已注册检查器。
     * 返回 ruleId → 命中列表。解析失败（非 Java / 语法不完整）时整体返回空 ——
     * 交还 LintEngine 如实归入 skipped，绝不伪造判定。
     */
    public Map<String, List<Finding>> lintFile(List<Rule> rules, String filename, String content) {
        Map<String, List<Finding>> out = new LinkedHashMap<>();
        Parsed parsed = null;
        for (Rule r : rules) {
            if (!hasChecker(r.id())) {
                continue;
            }
            if (parsed == null) {
                parsed = parse(filename, content);
                if (parsed == null) {
                    return out;
                }
            }
            ScanCtx ctx = new ScanCtx(parsed.cut(), new SourceText(content), parsed.pos());
            List<Finding> found = checkers.get(r.id()).check(r, ctx);
            if (!found.isEmpty()) {
                out.put(r.id(), found);
            }
        }
        return out;
    }

    // ──────────────────────────────────────────────── 解析

    private record Parsed(CompilationUnitTree cut, SourcePositions pos) {
    }

    private static Parsed parse(String filename, String content) {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            return null;
        }
        DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
        try (StandardJavaFileManager fm = compiler.getStandardFileManager(diags, null, StandardCharsets.UTF_8)) {
            String uriName = "string:///" + filename.replace('\\', '/').replace(' ', '_');
            JavaFileObject fo = new SimpleJavaFileObject(URI.create(uriName), JavaFileObject.Kind.SOURCE) {
                @Override
                public CharSequence getCharContent(boolean ignoreEncodingErrors) {
                    return content;
                }
            };
            JavacTask task = (JavacTask) compiler.getTask(null, fm, diags,
                    List.of("-proc:none", "-Xlint:none"), null, List.of(fo));
            Iterable<? extends CompilationUnitTree> units = task.parse();
            if (!units.iterator().hasNext()) {
                return null;
            }
            CompilationUnitTree cut = units.iterator().next();
            SourcePositions pos = Trees.instance(task).getSourcePositions();
            return new Parsed(cut, pos);
        } catch (IOException e) {
            return null;
        }
    }

    // ──────────────────────────────────────────────── 注册

    private void register() {
        checkers.put("CONC-POOL-001", this::cThreadCreation);
        checkers.put("SVC-LAYR-001", this::cFieldInjection);
        checkers.put("SVC-EXCP-001", this::cBareException);
        checkers.put("REL-EXCP-001", this::cEmptyCatch);
        checkers.put("REL-EXCP-003", this::cReturnInFinally);
        checkers.put("CONC-THRD-001", this::cStaticSdf);
        checkers.put("WEB-CTRL-002", this::cRequestBodyNoValid);
        checkers.put("WEB-CTRL-005", this::cPageSizeNoBound);
        checkers.put("SVC-TX-002", this::cTxNoRollbackFor);
        checkers.put("CONC-POOL-005", this::cAsyncNoPool);
        checkers.put("TEST-UNIT-002", this::cTestNoAssert);
        checkers.put("WEB-CTRL-004", this::cControllerTryCatch);
        checkers.put("WEB-CTRL-003", this::cRestControllerRawReturn);
        checkers.put("CONC-POOL-004", this::cThreadPoolNoPolicy);
        checkers.put("SVC-TX-001", this::cTxNonPublic);
    }

    // ──────────────────────────────────────────────── 检查器

    private List<Finding> cThreadCreation(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new TreeScanner<Void, Void>() {
            @Override
            public Void visitNewClass(NewClassTree node, Void p) {
                if ("Thread".equals(typeSimpleName(node.getIdentifier()))) {
                    out.add(f(rule, node, ctx, "显式创建线程：线程资源必须由线程池提供"));
                }
                return super.visitNewClass(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cFieldInjection(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new Ctx() {
            @Override
            public Void visitVariable(VariableTree node, Void p) {
                if (inClass() && !inMethod()
                        && hasAnnotation(node.getModifiers(), "Autowired", "Resource", "Inject")) {
                    out.add(f(rule, node, ctx, "字段注入：必须用构造器 + final 注入"));
                }
                return super.visitVariable(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cBareException(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new TreeScanner<Void, Void>() {
            @Override
            public Void visitThrow(ThrowTree node, Void p) {
                ExpressionTree e = node.getExpression();
                if (e instanceof NewClassTree nc) {
                    String n = typeSimpleName(nc.getIdentifier());
                    if (n.equals("RuntimeException") || n.equals("Exception") || n.equals("Throwable")) {
                        out.add(f(rule, node, ctx, "抛裸 " + n + "：必须抛自定义业务异常"));
                    }
                }
                return super.visitThrow(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cEmptyCatch(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new TreeScanner<Void, Void>() {
            @Override
            public Void visitCatch(CatchTree node, Void p) {
                BlockTree body = node.getBlock();
                boolean hasThrow = new ThrowFinder().scan(body, null) != null;
                boolean hasPrint = new PrintFinder().scan(body, null);
                if (body.getStatements().isEmpty()) {
                    out.add(f(rule, node, ctx, "空 catch：捕获后未做任何处理"));
                } else if (!hasThrow && hasPrint) {
                    out.add(f(rule, node, ctx, "catch 仅打印未重新抛出：异常被吞掉"));
                }
                return super.visitCatch(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cReturnInFinally(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new TreeScanner<Void, Void>() {
            @Override
            public Void visitTry(TryTree node, Void p) {
                BlockTree fb = node.getFinallyBlock();
                if (fb != null && new ReturnFinder().scan(fb, null) != null) {
                    out.add(f(rule, fb, ctx, "finally 块中使用 return：会掩盖 try/catch 的返回值与异常"));
                }
                return super.visitTry(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cStaticSdf(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new Ctx() {
            @Override
            public Void visitVariable(VariableTree node, Void p) {
                if (inClass() && !inMethod()
                        && node.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.STATIC)
                        && "SimpleDateFormat".equals(typeSimpleName(node.getType()))) {
                    out.add(f(rule, node, ctx, "SimpleDateFormat 作为 static 共享：非线程安全，改用 DateTimeFormatter"));
                }
                return super.visitVariable(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cRequestBodyNoValid(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new Ctx() {
            @Override
            public Void visitMethod(MethodTree node, Void p) {
                for (VariableTree param : node.getParameters()) {
                    if (hasAnnotation(param.getModifiers(), "RequestBody")
                            && !hasAnnotation(param.getModifiers(), "Valid")) {
                        out.add(f(rule, param, ctx, "@RequestBody 入参缺 @Valid：入参校验不生效"));
                    }
                }
                return super.visitMethod(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cPageSizeNoBound(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        Set<String> names = Set.of("pagesize", "size", "limit", "pagenum", "page");
        new Ctx() {
            @Override
            public Void visitMethod(MethodTree node, Void p) {
                for (VariableTree param : node.getParameters()) {
                    String n = param.getName().toString().toLowerCase();
                    boolean isPage = names.contains(n) || hasAnnotation(param.getModifiers(), "RequestParam");
                    if (isPage && !hasAnnotation(param.getModifiers(), "Min", "Max", "Range")) {
                        out.add(f(rule, param, ctx, "分页参数 " + param.getName() + " 无上限约束：可能接受无限制 pageSize"));
                    }
                }
                return super.visitMethod(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cTxNoRollbackFor(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new Ctx() {
            @Override
            public Void visitMethod(MethodTree node, Void p) {
                for (AnnotationTree a : node.getModifiers().getAnnotations()) {
                    if ("Transactional".equals(annName(a)) && !hasMember(a, "rollbackFor")) {
                        out.add(f(rule, node, ctx, "@Transactional 未声明 rollbackFor：依赖默认回滚规则不可控"));
                    }
                }
                return super.visitMethod(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cAsyncNoPool(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new Ctx() {
            @Override
            public Void visitMethod(MethodTree node, Void p) {
                for (AnnotationTree a : node.getModifiers().getAnnotations()) {
                    if ("Async".equals(annName(a)) && !hasMember(a, "value")) {
                        out.add(f(rule, node, ctx, "@Async 未绑定自定义线程池：使用默认执行器不可控"));
                    }
                }
                return super.visitMethod(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cTestNoAssert(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new Ctx() {
            @Override
            public Void visitMethod(MethodTree node, Void p) {
                if (hasAnnotation(node.getModifiers(), "Test") && node.getBody() != null) {
                    boolean hasAssert = Boolean.TRUE.equals(new AssertFinder().scan(node.getBody(), null));
                    if (!hasAssert) {
                        out.add(f(rule, node, ctx, "@Test 方法体无断言：用 System.out 人肉验证无效"));
                    }
                }
                return super.visitMethod(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cControllerTryCatch(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new TreeScanner<Void, Void>() {
            @Override
            public Void visitClass(ClassTree node, Void p) {
                if (hasAnnotation(node.getModifiers(), "RestController", "Controller")
                        && new TryFinder().scan(node, null) != null) {
                    out.add(f(rule, node, ctx, "Controller 内含 try-catch：业务异常应由全局异常处理器统一出口"));
                }
                return super.visitClass(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cRestControllerRawReturn(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new Ctx() {
            @Override
            public Void visitClass(ClassTree node, Void p) {
                if (!hasAnnotation(node.getModifiers(), "RestController")) {
                    return super.visitClass(node, p);
                }
                for (Tree member : node.getMembers()) {
                    if (member instanceof MethodTree m && m.getReturnType() != null) {
                        String rt = typeSimpleName(m.getReturnType());
                        boolean ok = rt.equals("ApiResponse") || rt.equals("ResponseEntity")
                                || rt.equals("void") || isPrimitive(rt);
                        if (!ok) {
                            out.add(f(rule, m, ctx, "接口裸返回 " + rt + "：应统一返回 ApiResponse/ResponseEntity"));
                        }
                    }
                }
                return super.visitClass(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cThreadPoolNoPolicy(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new TreeScanner<Void, Void>() {
            @Override
            public Void visitNewClass(NewClassTree node, Void p) {
                if ("ThreadPoolExecutor".equals(typeSimpleName(node.getIdentifier()))
                        && node.getArguments().size() < 7) {
                    out.add(f(rule, node, ctx, "ThreadPoolExecutor 未显式指定容量与拒绝策略：默认 AbortPolicy 会沉默失败"));
                }
                return super.visitNewClass(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    private List<Finding> cTxNonPublic(Rule rule, ScanCtx ctx) {
        List<Finding> out = new ArrayList<>();
        new Ctx() {
            @Override
            public Void visitMethod(MethodTree node, Void p) {
                for (AnnotationTree a : node.getModifiers().getAnnotations()) {
                    if ("Transactional".equals(annName(a))
                            && !node.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.PUBLIC)) {
                        out.add(f(rule, node, ctx, "@Transactional 落在非 public 方法上：Spring 代理不生效"));
                    }
                }
                return super.visitMethod(node, p);
            }
        }.scan(ctx.cut(), null);
        return out;
    }

    // ──────────────────────────────────────────────── 辅助扫描器

    /** 维护 class/method 栈，用于区分字段 / 局部变量 / 参数。 */
    private static class Ctx extends TreeScanner<Void, Void> {
        final Deque<ClassTree> classes = new ArrayDeque<>();
        final Deque<MethodTree> methods = new ArrayDeque<>();

        @Override
        public Void visitClass(ClassTree node, Void p) {
            classes.push(node);
            Void r = super.visitClass(node, p);
            classes.pop();
            return r;
        }

        @Override
        public Void visitMethod(MethodTree node, Void p) {
            methods.push(node);
            Void r = super.visitMethod(node, p);
            methods.pop();
            return r;
        }

        boolean inClass() {
            return !classes.isEmpty();
        }

        boolean inMethod() {
            return !methods.isEmpty();
        }
    }

    /** 在子树里查找任意 ThrowTree，返回非 null 即找到。 */
    private static class ThrowFinder extends TreeScanner<Boolean, Void> {
        @Override
        public Boolean scan(Tree node, Void p) {
            if (node == null) {
                return null;
            }
            Boolean r = super.scan(node, p);
            return r != null ? r : (node instanceof ThrowTree ? Boolean.TRUE : null);
        }
    }

    /** 在子树里查找 printStackTrace / log.* / logger.* 调用。 */
    private static class PrintFinder extends TreeScanner<Boolean, Void> {
        @Override
        public Boolean visitMethodInvocation(MethodInvocationTree node, Void p) {
            String sel = node.getMethodSelect().toString();
            if (sel.endsWith("printStackTrace")
                    || sel.startsWith("log.") || sel.startsWith("logger.")
                    || sel.startsWith("LOG.") || sel.startsWith("this.log")) {
                return Boolean.TRUE;
            }
            return super.visitMethodInvocation(node, p);
        }
    }

    /** 在子树里查找 return 语句。 */
    private static class ReturnFinder extends TreeScanner<Boolean, Void> {
        @Override
        public Boolean visitReturn(ReturnTree node, Void p) {
            return Boolean.TRUE;
        }
    }

    /** 在子树里查找 assert* 调用。 */
    private static class AssertFinder extends TreeScanner<Boolean, Void> {
        @Override
        public Boolean visitMethodInvocation(MethodInvocationTree node, Void p) {
            String sel = node.getMethodSelect().toString();
            if (sel.contains("assert")) {
                return Boolean.TRUE;
            }
            return super.visitMethodInvocation(node, p);
        }
    }

    /** 在子树里查找任意 try 语句。 */
    private static class TryFinder extends TreeScanner<Boolean, Void> {
        @Override
        public Boolean visitTry(TryTree node, Void p) {
            return Boolean.TRUE;
        }
    }

    // ──────────────────────────────────────────────── 静态工具

    private static Finding f(Rule rule, Tree node, ScanCtx ctx, String msg) {
        long pos = ctx.pos().getStartPosition(ctx.cut(), node);
        int line = ctx.src().lineOf(pos);
        return new Finding(rule.id(), line, msg, ctx.src().snippetAt(pos, 140));
    }

    private static String annName(AnnotationTree a) {
        Tree t = a.getAnnotationType();
        if (t instanceof IdentifierTree it) {
            return it.getName().toString();
        }
        if (t instanceof MemberSelectTree mt) {
            return mt.getIdentifier().toString();
        }
        return t.toString();
    }

    private static boolean hasAnnotation(ModifiersTree m, String... names) {
        if (m == null) {
            return false;
        }
        for (AnnotationTree a : m.getAnnotations()) {
            String n = annName(a);
            for (String want : names) {
                if (n.equals(want)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean hasMember(AnnotationTree a, String member) {
        for (ExpressionTree arg : a.getArguments()) {
            if (arg instanceof AssignmentTree as && as.getVariable() instanceof IdentifierTree id) {
                if (id.getName().toString().equals(member)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static String typeSimpleName(Tree t) {
        if (t instanceof IdentifierTree it) {
            return it.getName().toString();
        }
        if (t instanceof MemberSelectTree mt) {
            return mt.getIdentifier().toString();
        }
        if (t instanceof ParameterizedTypeTree pt) {
            return typeSimpleName(pt.getType());
        }
        return t == null ? "" : t.toString();
    }

    private static boolean isPrimitive(String name) {
        return Set.of("int", "long", "double", "float", "boolean", "byte", "short", "char", "void")
                .contains(name);
    }
}
