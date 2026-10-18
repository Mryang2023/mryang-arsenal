package com.arsenal.projects;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/**
 * 项目身份算法 —— **全仓唯一一份**。
 *
 * <p>这是「工坊棒1」要统一的那个暗伤的根治点：原先后端 QA 用 sha256-12，
 * 前端/Node 快照用 FNV-1a（{@code pj-…}），同一个地址在两套系统里算出两个身份，
 * 于是缓存目录 {@code .data/projects/<id>/} 与 QA 历史 {@code .data/qa/<id>/} 永远对不上。
 *
 * <p>统一规则（与既有 {@code QaService.projectIdOf} 逐字节一致，保证旧 QA 历史不作废）：
 * <pre>{@code
 *   normalized = kind + ":" + value.trim().replace('\\','/').replaceAll("/+$","")
 *   projectId  = sha256(normalized 的 UTF-8 字节) 的前 12 位十六进制
 * }</pre>
 *
 * <p>设计取舍（写死在这里，免得后人又分叉）：
 * <ul>
 *   <li>用未脱敏原值算 id —— 既有 {@code .data/qa/<id>/} 历史是按原值算的，改脱敏会令历史全部失效；
 *       注册表里存脱敏值只作展示，与 id 算法解耦。</li>
 *   <li>只取前 12 位十六进制（48 bit）—— 不是安全用途，碰撞代价只是两个项目共用一份缓存，可接受。</li>
 *   <li>{@code kind} 进串：本地目录 {@code a} 与 git 地址含 {@code a} 必须区分，否则会串项目。</li>
 * </ul>
 */
public final class ProjectIds {

    private ProjectIds() {
    }

    /** 规范化：去首尾空白、反斜杠转正斜杠、去掉结尾斜杠（与既有算法一致）。 */
    public static String normalize(String kind, String value) {
        String v = value == null ? "" : value.trim().replace('\\', '/').replaceAll("/+$", "");
        return (kind == null ? "" : kind) + ":" + v;
    }

    /**
     * 项目身份。同一 (kind, value) 永远得到同一串，重启后亦然。
     *
     * @param kind  'path' | 'git'
     * @param value 原始输入（未脱敏）
     * @return 12 位十六进制串，例如 {@code a1b2c3d4e5f6}
     */
    public static String projectIdOf(String kind, String value) {
        byte[] d;
        try {
            d = MessageDigest.getInstance("SHA-256")
                    .digest(normalize(kind, value).getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("JDK 必有 SHA-256", e);
        }
        return HexFormat.of().formatHex(d).substring(0, 12);
    }
}
