package com.acme.gateway;

import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

@Service
public class PaymentProxy {

    private final WebClient webClient = WebClient.builder().baseUrl("http://payment-host:9999").build();
}
