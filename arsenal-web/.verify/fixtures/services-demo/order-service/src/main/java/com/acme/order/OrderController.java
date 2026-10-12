package com.acme.order;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {

    @GetMapping("/api/orders")
    public String list() {
        return "orders";
    }

    @PostMapping("/api/orders")
    public String create() {
        return "created";
    }
}
