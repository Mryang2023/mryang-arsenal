package com.demo.controller;

import com.demo.repository.OrderRepository;
import com.demo.service.OrderService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {

    private final OrderService orderService;
    // 跨带直连：Controller 直接持有 Repository —— 扫描会把它标成警示线
    private final OrderRepository orderRepository;

    public OrderController(OrderService orderService, OrderRepository orderRepository) {
        this.orderService = orderService;
        this.orderRepository = orderRepository;
    }

    @GetMapping("/api/orders/{id}")
    public String get(@PathVariable Long id) {
        return orderService.describe(id);
    }

    @PostMapping("/api/orders")
    public String create() {
        return "ok";
    }
}
