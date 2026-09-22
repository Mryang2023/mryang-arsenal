package com.demo.repository;

import org.springframework.stereotype.Repository;

@Repository
public class OrderRepository {
    public String findOne(Long id) {
        return "row";
    }
}
