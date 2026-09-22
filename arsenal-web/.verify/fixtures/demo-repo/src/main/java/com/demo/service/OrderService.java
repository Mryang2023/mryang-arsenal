package com.demo.service;

import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;

@Service
public class OrderService {

    public String describe(Long id) {
        return "order-" + id;
    }

    @Scheduled(cron = "0 0/5 * * * ?")
    public void sweep() {
        // 定时清理
    }
}
