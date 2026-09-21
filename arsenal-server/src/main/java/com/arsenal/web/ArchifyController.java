package com.arsenal.web;

import com.arsenal.archify.ArchifyService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 通用绘图器（Archify）的出图接口。
 *
 * <p>存在的理由：前端是静态导出站，浏览器里跑不了对方的 Node 渲染器。
 * 这里是「页面里点一下就出 HTML」缺的那一环 —— 见 {@link ArchifyService} 开头的说明。
 *
 * <p>两个动作：
 * <ul>
 *   <li>{@code GET /api/archify} —— 这台机器能不能出图。页面上按钮的亮灭由它决定，
 *       不可用时要能说清「缺什么、怎么补」，所以返回的原因码与说明都要如实带出去。</li>
 *   <li>{@code POST /api/archify/deliver} —— 拿一份 IR，出一份 HTML + 校验收据。</li>
 * </ul>
 *
 * <p>请求体就是 IR 本身（{@code Content-Type: application/json}），不套壳 ——
 * 页面上复制/下载到的那份 JSON 原样 POST 过来即可，两处形状不同就要多一层转换，
 * 多一层转换就多一处会漂移的地方。
 */
@RestController
@RequestMapping("/api/archify")
public class ArchifyController {

    private final ArchifyService service;

    public ArchifyController(ArchifyService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<ArchifyService.Probe> status() {
        return ApiResponse.ok(service.probe());
    }

    @PostMapping("/deliver")
    public ApiResponse<ArchifyService.DeliverOutcome> deliver(@RequestBody JsonNode spec) {
        return ApiResponse.ok(service.deliver(spec));
    }
}
