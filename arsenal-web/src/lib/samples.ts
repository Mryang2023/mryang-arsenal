/**
 * 校验台演示样本。
 *
 * 这些不是「随便找的烂代码」，而是针对性构造的靶子：每段都刻意踩中若干条规则，
 * 用来验证引擎的检出能力。如果引擎找不出这些，说明规则写得不合格，不是代码合格。
 */

export interface Sample {
  key: string;
  name: string;
  label: string;
  desc: string;
  /**
   * 正则层能检出的违规处数（实测值，由 .verify/run.ts 自检脚本比对）。
   *
   * 这个数字是**断言**，不是注释 —— 改了引擎或规则之后它会红，
   * 红了要先回答「引擎少检出了什么」再决定改数字。
   *
   * 注意这是「正则层」的口径，不是全部规则的口径 ——
   * 这些样本同时违反了更多 AST / 语义层规则，那部分检不了，如实标注为未覆盖。
   */
  expected: number;
  content: string;
}

const badController = `package com.smarthub.Controller;

import javax.validation.Valid;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/user")
public class UserController {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private UserService userService;

    @PostMapping("/create")
    public Map<String, Object> create(@RequestBody UserRequest req) {
        try {
            Integer n = jdbcTemplate.queryForObject(
                "select count(*) from t_user where name = '" + req.getName() + "'", Integer.class);
            if (n != null && n > 0) {
                throw new RuntimeException("用户已存在");
            }
            Map<String, Object> result = new HashMap<>();
            result.put("name", req.getName());
            return result;
        } catch (Exception e) {
            e.printStackTrace();
            return new HashMap<>();
        }
    }

    @GetMapping("/delete/{id}")
    public void delete(@PathVariable Long id) {
        userService.delete(id);
    }

    @GetMapping("/list")
    public List<User> list(@RequestParam(defaultValue = "10") int pageSize) {
        Thread t = new Thread(() -> userService.exportAll());
        t.start();
        return userService.list(pageSize);
    }
}
`;

const badService = `package com.smarthub.service;

import java.text.SimpleDateFormat;
import java.util.Date;

@Service
public class OrderService {

    private static final SimpleDateFormat SDF = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

    @Autowired
    private OrderMapper orderMapper;

    @Transactional
    public void create(Order order) {
        orderMapper.insert(order);
        try {
            Thread.sleep(2000);
        } catch (InterruptedException e) {
            // 忽略
        }
        log.info("订单已创建 " + order.getId() + " 时间 " + SDF.format(new Date()));
    }

    public String export(ObjectInputStream in) throws Exception {
        return (String) in.readObject();
    }
}
`;

const badPom = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.5</version>
  </parent>

  <dependencies>
    <!-- 已有 BOM 托管版本，这里又写死了版本 -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.2.5</version>
    </dependency>

    <dependency>
      <groupId>com.smarthub</groupId>
      <artifactId>smarthub-common</artifactId>
      <version>1.2.0-SNAPSHOT</version>
    </dependency>
  </dependencies>
</project>
`;

const badSql = `-- 建表脚本
create table if not exists t_Order (
  id bigint not null auto_increment,
  orderNo varchar(64) not null comment '订单号',
  status tinyint(1) not null default 0 comment '状态',
  createTime datetime not null,
  primary key (id)
) engine = InnoDB default charset = utf8mb4;

-- 查询
select * from t_Order where status = 1;

select count(1) from t_Order where status = 1;
`;

const badConfig = `server:
  port: 3001

spring:
  datasource:
    url: jdbc:mysql://127.0.0.1:3306/smart_hub?useUnicode=true
    username: root
    password: root123456
    driver-class-name: com.mysql.cj.jdbc.Driver

jwt:
  secret: mySecretKey2026
  expire-seconds: 7200
`;

export const SAMPLES: Sample[] = [
  {
    key: 'controller',
    name: 'src/main/java/com/smarthub/Controller/UserController.java',
    label: '违规 Controller',
    desc: 'AI 最典型的产出：功能跑得通，但包名、命名空间、注入方式、契约、异常出口、并发全错。',
    expected: 9,
    content: badController,
  },
  {
    key: 'service',
    name: 'src/main/java/com/smarthub/service/OrderService.java',
    label: '违规 Service',
    desc: '线程不安全的 SimpleDateFormat、sleep 当重试、日志字符串拼接、字段注入、裸 RuntimeException。',
    expected: 5,
    content: badService,
  },
  {
    key: 'pom',
    name: 'pom.xml',
    label: '违规 pom.xml',
    desc: 'BOM 已托管版本却又写死版本号（命中 2 处），且依赖 SNAPSHOT。',
    expected: 3,
    content: badPom,
  },
  {
    key: 'sql',
    name: 'src/main/resources/db/schema.sql',
    label: '违规建表脚本',
    desc: '表名含大写、tinyint(1) 当布尔用、select *、count(1) 代替 count(*)。',
    expected: 4,
    content: badSql,
  },
  {
    key: 'config',
    name: 'src/main/resources/application.yml',
    label: '违规配置',
    desc: '数据库密码与 JWT 密钥明文写进配置文件（命中 2 处）。',
    expected: 2,
    content: badConfig,
  },
];
