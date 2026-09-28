package {{basePackage}}.config;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;

/**
 * MyBatis-Plus 分页插件。没有它 selectPage 不报错，只是把 page/size
 * 静默忽略返回整张表 —— 属于「上线三个月才被发现」级别的事故，这里显式注册。
 *
 * 只挂分页一个内部拦截器：乐观锁、防全表更新等按需再加，
 * 脚手架里每多一个默认行为，就多一份「为什么数据被改了」的排查成本。
 */
@Configuration
public class MybatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // 不传 DbType：方言由运行期数据源自动探测，MySQL/PostgreSQL 两套选型共用本配置
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
        return interceptor;
    }
}
