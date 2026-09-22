package com.demo;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

/** 只有一个测试方法：扫描器要能看出「这个仓库有测试」，但不该把它当业务代码算进分层 */
class OrderServiceTest {

    @Test
    void describeReturnsId() {
        assertTrue(true);
    }
}
