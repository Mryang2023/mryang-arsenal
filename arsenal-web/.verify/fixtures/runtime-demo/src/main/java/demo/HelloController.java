package demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * fixture 的唯一端点。让「起了」有第二个可验证信号 ——
 * 光看 Tomcat 报端口，只能证明端口开着，不能证明应用真的接得住请求。
 */
@RestController
public class HelloController {

    @GetMapping("/hello")
    public String hello() {
        return "ARSENAL-RUNTIME-DEMO-OK";
    }
}
