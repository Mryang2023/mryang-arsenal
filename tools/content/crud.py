# -*- coding: utf-8 -*-
"""蓝图 01：标准 CRUD 垂直切片。"""

CTRL = r"""package com.example.user.controller;

import com.example.common.ApiResponse;
import com.example.common.PageResult;
import com.example.user.dto.CreateUserRequest;
import com.example.user.dto.UpdateUserRequest;
import com.example.user.dto.UserQuery;
import com.example.user.dto.UserResponse;
import com.example.user.service.UserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 用户接口层。
 *
 * 职责边界（越界即违反 WEB-CTRL-001）：
 *   只做三件事 —— 接参数、调 Service、包响应。
 *   任何 if 业务判断、任何 SQL、任何数据源访问，都不属于这里。
 *
 * 类上加 @Validated 的原因：
 *   方法参数上的 @Min / @Max 这类「方法级校验」默认不生效，
 *   必须由 @Validated 触发 MethodValidationPostProcessor 才会真正拦下来。
 *   少了它，@PathVariable @Min(1) 就只是一行装饰。
 */
@Validated
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private final UserService userService;

    /**
     * 构造器注入：依赖 final 不可变，单测可直接 new，无需启动容器（SVC-LAYR-001）。
     * 禁止 @Autowired 字段注入 —— 它让依赖可以中途被替换、让循环依赖被悄悄容忍。
     */
    public UserController(UserService userService) {
        this.userService = userService;
    }

    /** 分页查询。GET 必须幂等且无副作用（WEB-CTRL-006）。 */
    @GetMapping
    public ApiResponse<PageResult<UserResponse>> page(@Valid UserQuery query) {
        return ApiResponse.ok(userService.page(query));
    }

    /** 查详情。id 加上限校验，非法入参在这一层就被挡掉，不会打到数据库。 */
    @GetMapping("/{id}")
    public ApiResponse<UserResponse> detail(@PathVariable @Min(value = 1, message = "id 必须为正整数") long id) {
        return ApiResponse.ok(userService.detail(id));
    }

    /** 创建。POST 非幂等：同一份报文提交两次会产生两条记录，这是语义要求。 */
    @PostMapping
    public ApiResponse<Long> create(@Valid @RequestBody CreateUserRequest request) {
        return ApiResponse.created(userService.create(request));
    }

    /** 全量更新。PUT 幂等：同一份报文重复提交，最终状态一致。 */
    @PutMapping("/{id}")
    public ApiResponse<Void> update(@PathVariable @Min(value = 1, message = "id 必须为正整数") long id,
                                    @Valid @RequestBody UpdateUserRequest request) {
        userService.update(id, request);
        return ApiResponse.ok();
    }

    /** 删除。DELETE 幂等：删除一个不存在的记录不应报错，重复删除结果都是「已不存在」。 */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable @Min(value = 1, message = "id 必须为正整数") long id) {
        userService.delete(id);
        return ApiResponse.ok();
    }
}
"""

CREATE_REQ = r"""package com.example.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 创建用户的入参。
 *
 * 为什么必须是独立 DTO，而不是直接收 Entity（WEB-DTO-001）：
 *   1. 收 Entity 等于把「客户端能改哪些字段」交给对方 —— 攻击者可以自行塞入
 *      id、status、createTime，越权写入内部字段；
 *   2. Entity 字段一改动就变成对外的破坏性契约变更，入参 DTO 可以把两者解耦。
 *
 * 用 record 而不是 class：不可变、无 getter 噪音、字段即契约，一眼看全。
 */
public record CreateUserRequest(

        @NotBlank(message = "用户名不能为空")
        @Size(min = 3, max = 32, message = "用户名长度须在 3~32 之间")
        @Pattern(regexp = "^[a-zA-Z0-9_]+$", message = "用户名只能包含字母、数字与下划线")
        String username,

        @NotBlank(message = "手机号不能为空")
        @Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
        String mobile,

        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        @Size(max = 128, message = "邮箱长度不能超过 128")
        String email,

        @NotBlank(message = "密码不能为空")
        @Size(min = 8, max = 64, message = "密码长度须在 8~64 之间")
        String password
) {
}
"""

UPDATE_REQ = r"""package com.example.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 更新用户的入参。
 *
 * 关键设计：这里刻意没有 username 字段。
 *   用户名是业务主键（登录凭据），修改它是「改名」这个独立业务动作，
 *   不该混在普通资料更新里。少了这个字段，调用方就无从越权改它。
 *   —— 入参 DTO 的字段列表本身就是一道权限边界。
 */
public record UpdateUserRequest(

        @NotBlank(message = "手机号不能为空")
        @Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
        String mobile,

        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        @Size(max = 128, message = "邮箱长度不能超过 128")
        String email,

        @NotNull(message = "状态不能为空")
        @Min(value = 1, message = "状态取值非法")
        @Max(value = 3, message = "状态取值非法")
        Integer status
) {
}
"""

QUERY = r"""package com.example.user.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * 分页查询入参。
 *
 * pageSize 必须有硬上限（WEB-CTRL-005）：
 *   不设上限时，一次 pageSize=1000000 就能同时把数据库、网络和 JVM 堆打满。
 *   这是最廉价、最常见的攻击面，且往往是压测时才第一次暴露。
 *
 * 用 class 而不是 record：@ModelAttribute 走的是「无参构造 + setter 绑定」，
 * class 的绑定行为最没有歧义。
 */
public class UserQuery {

    @Min(value = 1, message = "页码从 1 开始")
    private int page = 1;

    @Min(value = 1, message = "每页条数至少为 1")
    @Max(value = 100, message = "每页最多 100 条")
    private int pageSize = 20;

    /**
     * 排序字段。注意：这个值绝不允许拼进 SQL 字符串（SEC-INPUT-001），
     * 必须经白名单映射后再使用，见 UserRepository 的 ORDER_WHITELIST。
     */
    private String sort = "id";

    private String username;

    private Integer status;

    public int getPage() {
        return page;
    }

    public void setPage(int page) {
        this.page = page;
    }

    public int getPageSize() {
        return pageSize;
    }

    public void setPageSize(int pageSize) {
        this.pageSize = pageSize;
    }

    public String getSort() {
        return sort;
    }

    public void setSort(String sort) {
        this.sort = sort;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }
}
"""

RESPONSE = r"""package com.example.user.dto;

import com.example.common.Desensitize;
import com.example.user.domain.User;
import java.time.LocalDateTime;

/**
 * 用户出参。
 *
 * 出参 DTO 与入参 DTO 必须分离，理由是它是最后一道数据边界的闸门：
 *   1. 绝不能出现 password_hash / salt / 内部备注（SEC-DATA-002）；
 *   2. 手机号、邮箱这类个人信息必须脱敏后再返回（SEC-DATA-001）；
 *   3. 脱敏集中写在 from() 里 —— 只有一处，就不会有某个接口忘记脱敏。
 *
 * 反面做法是直接返回 Entity，于是「加一个敏感字段」和「泄露一个敏感字段」
 * 变成同一个动作。
 */
public record UserResponse(
        Long id,
        String username,
        /** 已脱敏：138****8888 */
        String mobile,
        /** 已脱敏：a***@example.com */
        String email,
        Integer status,
        LocalDateTime createTime
) {

    /** 实体 → 出参。脱敏只在这里做一次。 */
    public static UserResponse from(User user) {
        return new UserResponse(
                user.getId(),
                user.getUsername(),
                Desensitize.mobile(user.getMobile()),
                Desensitize.email(user.getEmail()),
                user.getStatus(),
                user.getCreateTime()
        );
    }
}
"""

SERVICE = r"""package com.example.user.service;

import com.example.common.PageResult;
import com.example.common.exception.BizException;
import com.example.user.domain.User;
import com.example.user.dto.CreateUserRequest;
import com.example.user.dto.UpdateUserRequest;
import com.example.user.dto.UserQuery;
import com.example.user.dto.UserResponse;
import com.example.user.exception.UserNotFoundException;
import com.example.user.repository.UserRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 用户业务层。
 *
 * 事务的三条硬规矩（SVC-TX-001 / 002 / 003）：
 *
 *   1. 事务边界只落在 Service 的 public 方法上。
 *      写在 Controller 上，事务会覆盖参数解析和序列化；
 *      写在 Repository 上，多个写操作之间没有原子性。
 *
 *   2. 必须显式 rollbackFor = Exception.class。
 *      @Transactional 默认只对 RuntimeException 回滚。一旦有人把某个业务异常
 *      改成受检异常，事务就静默不回滚 —— 这是最难排查的一类数据事故，
 *      因为代码看起来完全正常。
 *
 *   3. 事务方法内不要做远程调用、HTTP 请求或耗时 IO。
 *      事务会一直占着数据库连接，长事务会把连接池拖干。
 *
 * 日志用 SLF4J 占位符而不是字符串拼接（REL-LOG-002）：
 *   拼接是无条件执行的，"id=" + id 在 debug 日志关闭时依然会构造字符串。
 */
@Service
public class UserService {

    private static final Logger log = LoggerFactory.getLogger(UserService.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    /** 只读事务：让数据库与连接池能做只读优化，也防止误写。 */
    @Transactional(readOnly = true)
    public PageResult<UserResponse> page(UserQuery query) {
        int offset = (query.getPage() - 1) * query.getPageSize();
        List<User> rows = userRepository.page(query, offset);
        long total = userRepository.count(query);
        List<UserResponse> records = rows.stream().map(UserResponse::from).toList();
        return PageResult.of(records, total, query.getPage(), query.getPageSize());
    }

    @Transactional(readOnly = true)
    public UserResponse detail(long id) {
        return UserResponse.from(loadOrThrow(id));
    }

    /**
     * 创建用户。
     *
     * 查重与落库必须在同一个事务里：否则并发请求会同时通过 existsByUsername，
     * 双双写入。真正的最后一道防线是数据库唯一索引，事务负责把冲突暴露出来。
     */
    @Transactional(rollbackFor = Exception.class)
    public Long create(CreateUserRequest request) {
        if (userRepository.existsByUsername(request.username())) {
            throw new BizException("USERNAME_TAKEN", "用户名已被占用");
        }

        User user = new User();
        user.setUsername(request.username());
        user.setMobile(request.mobile());
        user.setEmail(request.email());
        // 密码只落摘要，永远不存明文也不可逆（SEC-DATA-002）
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setStatus(1);

        long id = userRepository.insert(user);
        log.info("用户已创建 id={} username={}", id, request.username());
        return id;
    }

    @Transactional(rollbackFor = Exception.class)
    public void update(long id, UpdateUserRequest request) {
        User user = loadOrThrow(id);
        user.setMobile(request.mobile());
        user.setEmail(request.email());
        user.setStatus(request.status());

        if (userRepository.update(user) == 0) {
            // 影响行数为 0 说明记录在读取之后被删除了。这是并发冲突，
            // 必须显式失败，不能当作「更新成功」静默略过。
            throw new BizException("USER_CONCURRENT_MODIFIED", "用户已被修改，请刷新后重试");
        }
        log.info("用户已更新 id={}", id);
    }

    @Transactional(rollbackFor = Exception.class)
    public void delete(long id) {
        loadOrThrow(id);
        userRepository.deleteById(id);
        log.info("用户已删除 id={}", id);
    }

    /**
     * 「记录不存在」的唯一出口。
     * 把它收成一个私有方法，是为了保证任何路径都不会漏掉这个判断。
     */
    private User loadOrThrow(long id) {
        User user = userRepository.findById(id);
        if (user == null) {
            throw new UserNotFoundException(id);
        }
        return user;
    }
}
"""

REPO = r"""package com.example.user.repository;

import com.example.user.domain.User;
import com.example.user.dto.UserQuery;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/**
 * 数据访问层。
 *
 * 三条不可让步的规矩：
 *   1. 参数一律用 ? 占位符绑定，禁止任何字符串拼接（DATA-SQL-001）。
 *      拼接 SQL 等于把注入能力交给调用方，且预编译缓存也失效。
 *   2. 必须显式列出字段，禁止 SELECT *（DATA-SQL-002）。
 *      SELECT * 的代价是「加一个字段就多传一份数据 + 一次隐式契约变更」。
 *   3. 所有 SQL 只存在于本层。Service 里出现 SQL 字符串即分层已经烂了。
 */
@Repository
public class UserRepository {

    /**
     * 字段白名单。把列清单收敛成一个常量，
     * 既避免到处 SELECT *，也让「新增字段」变成一次显式修改。
     */
    private static final String COLS =
            "id, username, mobile, email, password_hash, status, create_time, update_time";

    /** 排序白名单：排序字段永远不能直接来自用户输入（SEC-INPUT-001）。 */
    private static final Map<String, String> ORDER_WHITELIST = Map.of(
            "id", "id",
            "createTime", "create_time",
            "username", "username"
    );

    private final JdbcTemplate jdbcTemplate;

    /** 行映射只写一次，所有查询共用，避免「某处少映射一个字段」这种隐性 bug。 */
    private final RowMapper<User> rowMapper = (rs, rowNum) -> {
        User user = new User();
        user.setId(rs.getLong("id"));
        user.setUsername(rs.getString("username"));
        user.setMobile(rs.getString("mobile"));
        user.setEmail(rs.getString("email"));
        user.setPasswordHash(rs.getString("password_hash"));
        user.setStatus(rs.getInt("status"));
        user.setCreateTime(rs.getTimestamp("create_time").toLocalDateTime());
        user.setUpdateTime(rs.getTimestamp("update_time").toLocalDateTime());
        return user;
    };

    public UserRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<User> page(UserQuery query, int offset) {
        StringBuilder sql = new StringBuilder("SELECT " + COLS + " FROM user WHERE is_deleted = 0");
        List<Object> args = new ArrayList<>();

        // 条件用占位符，只有「排序字段」走白名单映射
        if (query.getUsername() != null && !query.getUsername().isBlank()) {
            sql.append(" AND username LIKE ?");
            args.add("%" + query.getUsername() + "%");
        }
        if (query.getStatus() != null) {
            sql.append(" AND status = ?");
            args.add(query.getStatus());
        }

        String orderBy = ORDER_WHITELIST.getOrDefault(query.getSort(), "id");
        sql.append(" ORDER BY ").append(orderBy).append(" LIMIT ? OFFSET ?");
        args.add(query.getPageSize());
        args.add(offset);

        return jdbcTemplate.query(sql.toString(), rowMapper, args.toArray());
    }

    public long count(UserQuery query) {
        StringBuilder sql = new StringBuilder("SELECT count(*) FROM user WHERE is_deleted = 0");
        List<Object> args = new ArrayList<>();
        if (query.getUsername() != null && !query.getUsername().isBlank()) {
            sql.append(" AND username LIKE ?");
            args.add("%" + query.getUsername() + "%");
        }
        if (query.getStatus() != null) {
            sql.append(" AND status = ?");
            args.add(query.getStatus());
        }
        // 统计行数用 count(*)（DATA-SQL-003）
        Long total = jdbcTemplate.queryForObject(sql.toString(), Long.class, args.toArray());
        return total == null ? 0L : total;
    }

    public User findById(long id) {
        String sql = "SELECT " + COLS + " FROM user WHERE id = ? AND is_deleted = 0";
        List<User> rows = jdbcTemplate.query(sql, rowMapper, id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public boolean existsByUsername(String username) {
        String sql = "SELECT count(*) FROM user WHERE username = ? AND is_deleted = 0";
        Long count = jdbcTemplate.queryForObject(sql, Long.class, username);
        return count != null && count > 0;
    }

    /** 插入并回填自增主键。 */
    public long insert(User user) {
        String sql = "INSERT INTO user (username, mobile, email, password_hash, status) VALUES (?, ?, ?, ?, ?)";
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, user.getUsername());
            ps.setString(2, user.getMobile());
            ps.setString(3, user.getEmail());
            ps.setString(4, user.getPasswordHash());
            ps.setInt(5, user.getStatus());
            return ps;
        }, keyHolder);
        return keyHolder.getKey().longValue();
    }

    /** 返回影响行数，由 Service 判断是否为并发冲突。 */
    public int update(User user) {
        String sql = "UPDATE user SET mobile = ?, email = ?, status = ?, update_time = now() "
                + "WHERE id = ? AND is_deleted = 0";
        return jdbcTemplate.update(sql, user.getMobile(), user.getEmail(), user.getStatus(), user.getId());
    }

    /** 逻辑删除：保留数据可追溯，同时让唯一索引继续生效。 */
    public int deleteById(long id) {
        String sql = "UPDATE user SET is_deleted = 1, update_time = now() WHERE id = ? AND is_deleted = 0";
        return jdbcTemplate.update(sql, id);
    }
}
"""

ENTITY = r"""package com.example.user.domain;

import java.time.LocalDateTime;

/**
 * 用户实体，与表 user 一一对应。
 *
 * 边界：实体只在 Repository 与 Service 之间流转，
 * 绝不出现在 Controller 的方法签名里（WEB-DTO-001）。
 *
 * 表结构三件套（DATA-SCHM-003）：id / create_time / update_time 必须齐备 ——
 * 少了 update_time，你永远说不清这条数据是什么时候变成现在这样的。
 */
public class User {

    private Long id;

    /** 登录名，业务唯一键。 */
    private String username;

    private String mobile;

    private String email;

    /**
     * 存的是 BCrypt 摘要，不可逆（SEC-DATA-002）。
     * 命名为 passwordHash 而不是 password，是为了让「这里存的是明文」在代码评审时无处藏身。
     */
    private String passwordHash;

    /** 1=正常 2=锁定 3=注销。 */
    private Integer status;

    /** 逻辑删除标记，库中为 is_ 前缀的 unsigned tinyint（DATA-SCHM-002）。 */
    private Integer isDeleted;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getMobile() {
        return mobile;
    }

    public void setMobile(String mobile) {
        this.mobile = mobile;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public Integer getIsDeleted() {
        return isDeleted;
    }

    public void setIsDeleted(Integer isDeleted) {
        this.isDeleted = isDeleted;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }
}
"""

BIZ_EXCEPTION = r"""package com.example.common.exception;

/**
 * 业务异常基类。
 *
 * 三条设计决策：
 *
 * 1. 继承 RuntimeException，不继承 Exception。
 *    业务失败若强制每层 throws，签名会被污染，且上层多半也只是继续往上抛。
 *
 * 2. 携带稳定错误码（字符串常量），而不是只有一句中文文案。
 *    文案会改，错误码不能改 —— 前端按码做分支，才不用去解析人类语言。
 *
 * 3. 不覆写 fillInStackTrace 做性能优化，除非压测证明它是瓶颈。
 *    提前优化掉堆栈，等于牺牲了唯一的排障线索（REL-LOG-003）。
 */
public class BizException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String code;

    public BizException(String code, String message) {
        super(message);
        this.code = code;
    }

    public BizException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
"""

NOT_FOUND = r"""package com.example.user.exception;

import com.example.common.exception.BizException;

/**
 * 具体的业务异常。
 *
 * 为什么必须自定义而不是抛裸 RuntimeException（SVC-EXCP-001）：
 *   全局处理器无法从 RuntimeException 里区分「用户不存在」和「除零」，
 *   只能一律按 500 处理；前端拿不到可判定的错误码，也无法做差异化提示。
 *   异常 = 错误码 + 稳定文案，它属于接口契约，不是实现细节。
 *
 * 错误码用常量而非散落的字符串字面量（COL-CODE-003 的同类问题）：
 *   文案可以改，码不可以改，也不允许出现拼写漂移。
 */
public class UserNotFoundException extends BizException {

    /** 稳定错误码：前端与调用方按此分支，终身不变。 */
    public static final String CODE = "USER_NOT_FOUND";

    public UserNotFoundException(long id) {
        super(CODE, "用户不存在：" + id);
    }
}
"""

API_RESPONSE = r"""package com.example.common;

/**
 * 统一响应体（WEB-CTRL-003）。
 *
 * 约定：HTTP 状态码表达传输层语义（200 / 400 / 404 / 500），
 *      code 表达业务语义（0 = 成功，非 0 = 业务错误码）。
 *      两者各司其职，绝对不要用 code=200 去重复表达 HTTP 状态 ——
 *      那样监控、网关、重试策略就全部失效了。
 */
public record ApiResponse<T>(int code, String message, T data, long timestamp) {

    public static final int CODE_OK = 0;

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(CODE_OK, "ok", data, System.currentTimeMillis());
    }

    public static <T> ApiResponse<T> ok() {
        return ok(null);
    }

    public static <T> ApiResponse<T> created(T data) {
        return new ApiResponse<>(CODE_OK, "created", data, System.currentTimeMillis());
    }

    public static <T> ApiResponse<T> fail(int code, String message) {
        return new ApiResponse<>(code, message, null, System.currentTimeMillis());
    }
}
"""

PAGE_RESULT = r"""package com.example.common;

import java.util.List;

/**
 * 统一分页结构。
 *
 * 分页不是「返回一个 List 再塞两个 header」，它是一个结构化、可演进的契约。
 * 一旦把 total / page / pageSize 作为字段固定下来，
 * 以后要加分页游标、近似总数，都是向后兼容的增量。
 */
public record PageResult<T>(List<T> records, long total, int page, int pageSize) {

    public static <T> PageResult<T> of(List<T> records, long total, int page, int pageSize) {
        return new PageResult<>(records, total, page, pageSize);
    }

    /** 总页数。放在这里而不是让每个前端各算一遍，避免四舍五入口径不一致。 */
    public int totalPages() {
        return pageSize <= 0 ? 0 : (int) ((total + pageSize - 1) / pageSize);
    }
}
"""

HANDLER = r"""package com.example.common.web;

import com.example.common.ApiResponse;
import com.example.common.exception.BizException;
import com.example.user.exception.UserNotFoundException;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常出口（WEB-CTRL-004）。
 *
 * 三条铁律：
 *   1. Controller 内禁止 try-catch 业务异常 —— 一旦各写各的，
 *      就会出现「同一个错误在不同接口返回不同结构」，前端的容错逻辑永远写不完。
 *   2. 参数校验失败必须以 400 返回，并带上字段级原因。返回 500 等于告诉运维
 *      「系统坏了」，而实际上只是调用方写错了参数。
 *   3. 未预期异常必须打完整堆栈（REL-LOG-003），但绝不能把堆栈返给前端 ——
 *      堆栈里的类名、路径、SQL 片段都是攻击者的地图。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 业务异常：已知的、可预期失败，按 warn 记录，不打堆栈。 */
    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResponse<Void>> handleBiz(BizException e) {
        log.warn("业务异常 code={} message={}", e.getCode(), e.getMessage());

        HttpStatus status = UserNotFoundException.CODE.equals(e.getCode())
                ? HttpStatus.NOT_FOUND
                : HttpStatus.BAD_REQUEST;

        return ResponseEntity.status(status).body(ApiResponse.fail(40000, e.getMessage()));
    }

    /** 参数校验失败：把字段级原因拼出来，调用方一眼能看出改哪个字段。 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvalid(MethodArgumentNotValidException e) {
        String detail = e.getBindingResult().getFieldErrors().stream()
                .map(field -> field.getField() + ": " + field.getDefaultMessage())
                .collect(Collectors.joining("; "));

        log.warn("参数校验失败 {}", detail);
        return ResponseEntity.badRequest().body(ApiResponse.fail(40001, detail));
    }

    /**
     * 兜底：任何没被上面接住的异常都到这里。
     * 对外统一成一句「系统繁忙」，真实原因只留在日志里。
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception e) {
        log.error("未预期异常", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.fail(50000, "系统繁忙，请稍后重试"));
    }
}
"""

SCHEMA = r"""-- 用户表。
--
-- 命名（DATA-SCHM-001）：表名、字段名全小写、单数、不用保留字。
-- 三件套（DATA-SCHM-003）：id / create_time / update_time 必须齐备。
-- 布尔语义（DATA-SCHM-002）：用 is_ 前缀 + unsigned tinyint，不要用 char(1)。
-- 金额字段若存在必须用 decimal，禁止 float/double（浮点累加会丢精度）。
CREATE TABLE `user`
(
    `id`            bigint unsigned  NOT NULL AUTO_INCREMENT COMMENT '主键',
    `username`      varchar(32)      NOT NULL COMMENT '登录名',
    `mobile`        varchar(20)      NOT NULL COMMENT '手机号',
    `email`         varchar(128)     NOT NULL COMMENT '邮箱',
    `password_hash` varchar(72)      NOT NULL COMMENT 'BCrypt 摘要，禁止存明文',
    `status`        tinyint unsigned NOT NULL DEFAULT 1 COMMENT '1=正常 2=锁定 3=注销',
    `is_deleted`    tinyint unsigned NOT NULL DEFAULT 0 COMMENT '0=未删除 1=已删除',
    `create_time`   datetime         NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`   datetime         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    -- 唯一索引不只是约束，它是并发查重场景的最后一道防线：应用层的查重必然存在竞态窗口
    UNIQUE KEY `uk_username` (`username`),
    UNIQUE KEY `uk_mobile` (`mobile`),
    KEY `idx_status_create_time` (`status`, `create_time`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT = '用户';
"""

TEST = r"""package com.example.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.example.common.exception.BizException;
import com.example.user.domain.User;
import com.example.user.dto.CreateUserRequest;
import com.example.user.exception.UserNotFoundException;
import com.example.user.repository.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * UserService 单元测试。
 *
 * 三条要求：
 *   1. 不依赖真实数据库，外部依赖全部 Mock（TEST-UNIT-004）；
 *   2. 必须有断言，禁止 System.out 人肉看（TEST-UNIT-002）；
 *   3. 每个用例互相独立、可重复执行（TEST-UNIT-001）。
 *
 * 用例选取原则：覆盖「正常路径 + 每个分支出口」，而不是追求行覆盖率数字。
 * 这里 4 个用例对应 create 的分支、update 的并发冲突、detail 的 404。
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    private UserService userService;

    /**
     * 手工 new 而不是用 @InjectMocks。
     * 显式构造的好处是：Service 构造参数一旦变化，这里立刻编译失败 ——
     * 依赖变更在编译期暴露，而不是在运行期变成一个 NPE。
     */
    @BeforeEach
    void setUp() {
        userService = new UserService(userRepository, passwordEncoder);
    }

    @Test
    @DisplayName("创建用户：用户名已被占用时抛 USERNAME_TAKEN，且不写库")
    void create_shouldRejectDuplicateUsername() {
        CreateUserRequest request = new CreateUserRequest("mryang", "13800138000", "mryang@example.com", "P@ssw0rd123");
        given(userRepository.existsByUsername("mryang")).willReturn(true);

        BizException ex = assertThrows(BizException.class, () -> userService.create(request));

        assertThat(ex.getCode()).isEqualTo("USERNAME_TAKEN");
        // 关键断言：失败路径绝不能留下半条数据
        verify(userRepository, never()).insert(any());
    }

    @Test
    @DisplayName("创建用户：密码必须经过编码后落库，绝不存明文")
    void create_shouldStoreEncodedPassword() {
        CreateUserRequest request = new CreateUserRequest("mryang", "13800138000", "mryang@example.com", "P@ssw0rd123");
        given(userRepository.existsByUsername("mryang")).willReturn(false);
        given(passwordEncoder.encode("P@ssw0rd123")).willReturn("$2a$10$hashed");
        given(userRepository.insert(any(User.class))).willReturn(1001L);

        Long id = userService.create(request);

        assertThat(id).isEqualTo(1001L);
        verify(passwordEncoder).encode("P@ssw0rd123");
    }

    @Test
    @DisplayName("更新用户：影响行数为 0 时抛并发冲突，不当作成功")
    void update_shouldFailWhenNoRowAffected() {
        User existing = new User();
        existing.setId(7L);
        given(userRepository.findById(7L)).willReturn(existing);
        given(userRepository.update(any(User.class))).willReturn(0);

        BizException ex = assertThrows(BizException.class,
                () -> userService.update(7L, null));

        assertThat(ex.getCode()).isEqualTo("USER_CONCURRENT_MODIFIED");
    }

    @Test
    @DisplayName("查详情：记录不存在时抛 UserNotFoundException")
    void detail_shouldThrowWhenMissing() {
        given(userRepository.findById(404L)).willReturn(null);

        assertThrows(UserNotFoundException.class, () -> userService.detail(404L));
    }
}
"""

FEATURE = {
    "id": "crud-basic",
    "order": 1,
    "name": "标准 CRUD 垂直切片",
    "subtitle": "一张业务表，从 HTTP 入口一路到 SQL 的完整闭环",
    "glyph": "▤",
    "level": "核心",
    "scenario": (
        "任何「对某个业务实体做增删改查」的需求，都从这里开始抄。"
        "这套代码刻意写全了每一层，包括最容易漏掉的两处：入参 DTO 的分支出口、"
        "以及并发冲突时 Service 该怎么失败。"
    ),
    "intent": "把「一个功能怎么写」从口头约定变成可复制的完整代码。",
    "tags": ["CRUD", "REST", "端到端", "事务", "校验"],
    "relatedRules": [
        "WEB-CTRL-001", "WEB-CTRL-002", "WEB-CTRL-003", "WEB-CTRL-004", "WEB-CTRL-005",
        "WEB-DTO-001", "SVC-LAYR-001", "SVC-TX-001", "SVC-TX-002", "SVC-TX-003",
        "SVC-EXCP-001", "DATA-SQL-001", "DATA-SQL-002", "DATA-SQL-003",
        "DATA-SCHM-001", "DATA-SCHM-002", "DATA-SCHM-003",
        "REL-LOG-002", "REL-LOG-003", "SEC-DATA-001", "SEC-DATA-002", "SEC-INPUT-001",
        "TEST-UNIT-001", "TEST-UNIT-002", "TEST-UNIT-004",
    ],
    "flow": [
        {"layer": "client", "step": "HTTP 请求", "detail": "POST /api/v1/users，Content-Type: application/json"},
        {"layer": "web", "step": "UserController", "detail": "@Valid 触发 DTO 约束注解。校验不通过时请求根本到不了 Service —— 这是最省成本的一道拦截。"},
        {"layer": "service", "step": "UserService", "detail": "事务边界在这里。查重与落库必须同事务，否则并发下会产生重复用户名。"},
        {"layer": "repo", "step": "UserRepository", "detail": "JdbcTemplate 占位符绑定 + 显式列字段 + 排序白名单。"},
        {"layer": "sql", "step": "MySQL", "detail": "user 表。唯一索引是并发查重的最后防线 —— 应用层查重永远存在竞态窗口。"},
        {"layer": "web", "step": "GlobalExceptionHandler", "detail": "任何一层抛出的异常在此统一转成 ApiResponse，HTTP 状态码保持传输层语义。"},
    ],
    "packages": [
        "com.example.common           统一响应、分页结构、异常基类",
        "com.example.common.web       全局异常处理器、拦截器",
        "com.example.common.exception 业务异常基类",
        "com.example.user.controller  接口层",
        "com.example.user.dto         入参 / 出参 DTO",
        "com.example.user.domain      实体",
        "com.example.user.service     业务层",
        "com.example.user.repository  数据访问层",
        "com.example.user.exception   本领域业务异常",
    ],
    "files": [
        {
            "id": "controller",
            "path": "src/main/java/com/example/user/controller/UserController.java",
            "layer": "web",
            "lang": "java",
            "role": "接口层：接参数、调 Service、包响应。绝不承载业务判断。",
            "code": CTRL,
            "highlights": [
                {"mark": "@Validated\n@RestController", "title": "类上的 @Validated 不是装饰", "text": "方法参数上的 @Min / @Max 属于「方法级校验」，默认不生效，必须由类上的 @Validated 触发 MethodValidationPostProcessor。少了它，下面的 @PathVariable @Min(1) 完全不起作用。", "rule": "WEB-CTRL-002"},
                {"mark": "public UserController(UserService userService)", "title": "构造器注入，依赖 final", "text": "依赖不可变、无需容器即可 new 出来做单测。字段注入（@Autowired）会让依赖可被中途替换，并悄悄容忍循环依赖。", "rule": "SVC-LAYR-001"},
                {"mark": "@Valid @RequestBody CreateUserRequest", "title": "@Valid 必须加在 @RequestBody 上", "text": "这是全项目最容易漏的一个注解。漏掉它时，DTO 上所有 @NotBlank / @Email 全部静默失效 —— 没有任何报错，只是校验不再发生。", "rule": "WEB-CTRL-002"},
                {"mark": "public ApiResponse<PageResult<UserResponse>> page", "title": "出参是嵌套契约，不是裸 List", "text": "分页必须返回结构化契约（records + total + page + pageSize），前端才能渲染分页器。返回裸 List 时，调用方永远不知道还有没有下一页。", "rule": "WEB-CTRL-003"},
                {"mark": "@PathVariable @Min(value = 1", "title": "路径变量也要校验", "text": "路径参数是最容易被忽略的入参。加了上限校验，非法值在入口就被拒，不会带着负 id 一路打到数据库。", "rule": "SEC-INPUT-001"},
                {"mark": "ApiResponse.created(", "title": "创建成功用 created 语义", "text": "同一个响应结构里区分「查询成功」与「资源已创建」，前端不需要靠猜。", "rule": "WEB-CTRL-003"},
            ],
        },
        {
            "id": "create-request",
            "path": "src/main/java/com/example/user/dto/CreateUserRequest.java",
            "layer": "dto-in",
            "lang": "java",
            "role": "创建入参。字段列表本身就是一道权限边界。",
            "code": CREATE_REQ,
            "highlights": [
                {"mark": "public record CreateUserRequest(", "title": "record 让字段即契约", "text": "不可变、无 getter 噪音、一眼看全所有入参。改一个字段就是改一次契约，编译器会帮你找到所有调用点。", "rule": "WEB-DTO-001"},
                {"mark": "@NotBlank(message = \"用户名不能为空\")", "title": "每条约束都要写 message", "text": "约束注解的默认英文提示对使用者毫无价值。message 会经全局处理器汇总后返回给调用方，是接口可用性的一部分。", "rule": "WEB-CTRL-002"},
                {"mark": "@Pattern(regexp = \"^1[3-9]\\\\d{9}$\"", "title": "格式约束前移到入口", "text": "手机号格式在 DTO 层就判掉，不要留到 Service 里写 if。校验越靠前，下游需要防御的假设就越少。", "rule": "SEC-INPUT-001"},
            ],
        },
        {
            "id": "update-request",
            "path": "src/main/java/com/example/user/dto/UpdateUserRequest.java",
            "layer": "dto-in",
            "lang": "java",
            "role": "更新入参。刻意不含 username —— 字段缺席即权限边界。",
            "code": UPDATE_REQ,
            "highlights": [
                {"mark": "这里刻意没有 username 字段", "title": "用「字段不存在」表达「不可修改」", "text": "这是最省事也最可靠的权限设计：不去检查调用方有没有权限改用户名，而是压根不给他这个字段。检查会被遗忘，字段缺席不会。", "rule": "WEB-DTO-001"},
                {"mark": "@Max(value = 3, message = \"状态取值非法\")", "title": "枚举型入参必须约束取值范围", "text": "status 只允许 1~3。不约束的话，客户端传 99 会一路写进数据库，然后全站查询都查不到这条记录。", "rule": "SEC-INPUT-001"},
            ],
        },
        {
            "id": "query",
            "path": "src/main/java/com/example/user/dto/UserQuery.java",
            "layer": "dto-in",
            "lang": "java",
            "role": "分页查询入参。pageSize 必须有硬上限。",
            "code": QUERY,
            "highlights": [
                {"mark": "@Max(value = 100, message = \"每页最多 100 条\")", "title": "分页上限是安全要求，不是体验要求", "text": "不设上限时，一次 pageSize=1000000 就能同时打满数据库、网络带宽与 JVM 堆。这个攻击面零成本，且往往压测时才第一次暴露。", "rule": "WEB-CTRL-005"},
                {"mark": "private String sort = \"id\";", "title": "排序字段是注入高发区", "text": "page / pageSize 走占位符没问题，但 ORDER BY 后的字段名没法用占位符绑定。所以 sort 必须经白名单映射，见 UserRepository.ORDER_WHITELIST。", "rule": "SEC-INPUT-001"},
            ],
        },
        {
            "id": "response",
            "path": "src/main/java/com/example/user/dto/UserResponse.java",
            "layer": "dto-out",
            "lang": "java",
            "role": "出参。脱敏在这里一次性完成，是敏感数据最后一道闸门。",
            "code": RESPONSE,
            "highlights": [
                {"mark": "public static UserResponse from(User user)", "title": "脱敏只有一处出口", "text": "把手机号、邮箱的脱敏集中写在 from() 里，就不可能「某个接口忘了脱敏」。分散在 Controller 里各写一遍，早晚会漏。", "rule": "SEC-DATA-001"},
                {"mark": "String mobile,\n        /** 已脱敏", "title": "出参里不能有 passwordHash", "text": "出参 DTO 的价值在于「不存在即不会泄露」。直接返回 Entity 时，「加一个字段」和「泄露一个字段」是同一个动作。", "rule": "SEC-DATA-002"},
            ],
        },
        {
            "id": "service",
            "path": "src/main/java/com/example/user/service/UserService.java",
            "layer": "service",
            "lang": "java",
            "role": "业务层。事务边界、业务异常、并发冲突判断都在这里。",
            "code": SERVICE,
            "highlights": [
                {"mark": "@Transactional(rollbackFor = Exception.class)\n    public Long create", "title": "rollbackFor 必须显式声明", "text": "@Transactional 默认只回滚 RuntimeException。一旦有人把业务异常改成受检异常，事务就静默不回滚 —— 代码看起来完全正常，这才是最可怕的地方。", "rule": "SVC-TX-002"},
                {"mark": "userRepository.update(user) == 0", "title": "影响行数为 0 不是成功", "text": "影响行数 0 意味着记录在读取之后被删除了，这是并发冲突。当成成功静默略过，就等于接受了「用户以为改成功了，其实没改」。", "rule": "SVC-EXCP-001"},
                {"mark": "log.info(\"用户已创建 id={} username={}\", id, request.username());", "title": "SLF4J 占位符，不是字符串拼接", "text": "\"id=\" + id 是无条件执行的：即使日志级别没开，字符串也已经构造出来了。占位符还让日志可结构化解析。", "rule": "REL-LOG-002"},
                {"mark": "@Transactional(readOnly = true)\n    public PageResult<UserResponse> page", "title": "只读查询标注 readOnly", "text": "让数据库与连接池做只读优化，同时从语义上禁止了这个方法里出现写操作。", "rule": "SVC-TX-001"},
                {"mark": "private User loadOrThrow(long id)", "title": "「不存在」收成唯一出口", "text": "把判空抛异常收敛成一个私有方法，任何路径都不可能漏掉这个判断。这是用结构消灭重复，而不是用纪律。", "rule": "SVC-EXCP-001"},
            ],
        },
        {
            "id": "repository",
            "path": "src/main/java/com/example/user/repository/UserRepository.java",
            "layer": "repo",
            "lang": "java",
            "role": "数据访问层。所有 SQL 只存在于这里。",
            "code": REPO,
            "highlights": [
                {"mark": "private static final Map<String, String> ORDER_WHITELIST", "title": "排序字段白名单", "text": "ORDER BY 的字段名无法用 ? 绑定，只能拼接。所以必须经白名单映射 —— 这是最容易被忽略的一处注入点。", "rule": "SEC-INPUT-001"},
                {"mark": "private static final String COLS =", "title": "显式列字段，禁止 SELECT *", "text": "SELECT * 的代价是「加一个字段就多传一份数据 + 一次隐式契约变更」，而且预编译语句的复用会失效。", "rule": "DATA-SQL-002"},
                {"mark": "jdbcTemplate.query(sql.toString(), rowMapper, args.toArray());", "title": "参数一律占位符绑定", "text": "args.toArray() 传进去的是绑定值，不是拼进 SQL 的字符串。注意这里只拼接了「条件片段」与「排序字段（白名单）」，所有用户数据都走 ? 绑定。拼接用户数据等于把注入能力交给调用方。", "rule": "DATA-SQL-001"},
                {"mark": "private final RowMapper<User> rowMapper", "title": "行映射只写一次", "text": "所有查询共用同一个 RowMapper，避免「某处少映射一个字段」这种只有特定接口才复现的隐性 bug。", "rule": "DATA-SQL-002"},
                {"mark": "UPDATE user SET is_deleted = 1", "title": "逻辑删除而非物理删除", "text": "保留数据可追溯，同时让唯一索引继续生效（否则删掉用户后，同名用户名重新注册会撞唯一键）。", "rule": "DATA-SCHM-002"},
            ],
        },
        {
            "id": "entity",
            "path": "src/main/java/com/example/user/domain/User.java",
            "layer": "domain",
            "lang": "java",
            "role": "实体。只在 Repository 与 Service 之间流转，不出现在 Controller 签名里。",
            "code": ENTITY,
            "highlights": [
                {"mark": "private String passwordHash;", "title": "命名即防御", "text": "叫 passwordHash 而不是 password，是为了让「这里存的是明文」在代码评审时无处藏身。好命名能让错误变得显眼。", "rule": "SEC-DATA-002"},
                {"mark": "private LocalDateTime updateTime;", "title": "三件套缺一不可", "text": "id / create_time / update_time 必须齐备。少了 update_time，你永远说不清这条数据是什么时候变成现在这样的。", "rule": "DATA-SCHM-003"},
            ],
        },
        {
            "id": "biz-exception",
            "path": "src/main/java/com/example/common/exception/BizException.java",
            "layer": "exception",
            "lang": "java",
            "role": "业务异常基类。错误码是契约，文案不是。",
            "code": BIZ_EXCEPTION,
            "highlights": [
                {"mark": "public class BizException extends RuntimeException", "title": "继承 RuntimeException", "text": "业务失败不强制每层 throws，避免签名被污染。且受检异常会诱导开发者写 catch 后吞掉（REL-EXCP-001）。", "rule": "SVC-EXCP-001"},
                {"mark": "private final String code;", "title": "错误码与文案分离", "text": "文案会改，错误码不能改。前端按码做分支，才不需要去解析人类语言 —— 一旦开始解析文案，等于把中文字符串变成了接口协议。", "rule": "SVC-EXCP-001"},
            ],
        },
        {
            "id": "user-not-found",
            "path": "src/main/java/com/example/user/exception/UserNotFoundException.java",
            "layer": "exception",
            "lang": "java",
            "role": "具体业务异常。把「用户不存在」变成一个可判定的类型。",
            "code": NOT_FOUND,
            "highlights": [
                {"mark": "public static final String CODE = \"USER_NOT_FOUND\";", "title": "错误码用常量，不用字面量", "text": "散落的字符串字面量会漂移（NOT_FOUND / USER_NOTFOUND / USER_NOT_EXIST）。常量让编译器替你守住一致性。", "rule": "COL-CODE-003"},
                {"mark": "super(CODE, \"用户不存在：\" + id);", "title": "异常里带上定位信息", "text": "日志里只写「用户不存在」等于没说。带上 id，排障时可以直接去查这条记录。", "rule": "REL-LOG-003"},
            ],
        },
        {
            "id": "handler",
            "path": "src/main/java/com/example/common/web/GlobalExceptionHandler.java",
            "layer": "web",
            "lang": "java",
            "role": "全局异常出口。所有失败路径的唯一收口点。",
            "code": HANDLER,
            "highlights": [
                {"mark": "log.error(\"未预期异常\", e);", "title": "打堆栈但只回一句话", "text": "堆栈必须留在日志里（REL-LOG-003），但绝不能返给前端：类名、路径、SQL 片段都是攻击者的地图。", "rule": "REL-LOG-003"},
                {"mark": "HttpStatus.NOT_FOUND", "title": "业务错误码映射到 HTTP 状态", "text": "404 让网关、监控、重试策略都能正确工作。全部返回 200 + 自定义 code 的写法，会让整条基础设施链路失明。", "rule": "WEB-CTRL-003"},
                {"mark": "handleInvalid(MethodArgumentNotValidException e)", "title": "校验失败不能是 500", "text": "参数写错是调用方的问题，返回 500 等于告诉运维「系统坏了」。必须 400 + 字段级原因。", "rule": "WEB-CTRL-004"},
            ],
        },
        {
            "id": "api-response",
            "path": "src/main/java/com/example/common/ApiResponse.java",
            "layer": "common",
            "lang": "java",
            "role": "统一响应体。全项目所有接口的唯一外形。",
            "code": API_RESPONSE,
            "highlights": [
                {"mark": "public record ApiResponse<T>(int code, String message, T data, long timestamp)", "title": "HTTP 状态码与业务 code 各司其职", "text": "不要用 code=200 去重复表达 HTTP 状态。两者混用后，监控、网关、重试策略会全部失效，因为基础设施只认 HTTP 状态码。", "rule": "WEB-CTRL-003"},
            ],
        },
        {
            "id": "page-result",
            "path": "src/main/java/com/example/common/PageResult.java",
            "layer": "common",
            "lang": "java",
            "role": "统一分页结构。",
            "code": PAGE_RESULT,
            "highlights": [
                {"mark": "public int totalPages()", "title": "总页数口径只算一次", "text": "放在后端算，避免每个前端各实现一遍，然后四舍五入口径不一致 —— 这类差异会变成「某些页面少一页」的幽灵 bug。", "rule": "WEB-CTRL-003"},
            ],
        },
        {
            "id": "schema",
            "path": "src/main/resources/db/schema.sql",
            "layer": "sql",
            "lang": "sql",
            "role": "建表脚本。",
            "code": SCHEMA,
            "highlights": [
                {"mark": "UNIQUE KEY `uk_username` (`username`)", "title": "唯一索引是并发查重的最后防线", "text": "应用层的「先查再插」必然存在竞态窗口。真要靠数据库唯一索引兜底，让冲突以异常形式暴露出来。", "rule": "DATA-SCHM-001"},
                {"mark": "`is_deleted`    tinyint unsigned", "title": "布尔语义用 is_ 前缀 + unsigned tinyint", "text": "不要用 char(1) 存 Y/N，也不要直接叫 deleted。前缀本身说明了语义与类型。", "rule": "DATA-SCHM-002"},
                {"mark": "`update_time`   datetime", "title": "update_time 交给数据库维护", "text": "ON UPDATE CURRENT_TIMESTAMP 让时间戳不依赖应用代码 —— 手写的 setUpdateTime 总有某条路径会忘记调。", "rule": "DATA-SCHM-003"},
            ],
        },
        {
            "id": "test",
            "path": "src/test/java/com/example/user/service/UserServiceTest.java",
            "layer": "test",
            "lang": "java",
            "role": "单元测试。覆盖正常路径与每个分支出口。",
            "code": TEST,
            "highlights": [
                {"mark": "userService = new UserService(userRepository, passwordEncoder);", "title": "手工 new，不用 @InjectMocks", "text": "显式构造让 Service 构造参数一变，测试立刻编译失败 —— 依赖变更在编译期暴露，而不是运行期变成 NPE。", "rule": "TEST-UNIT-001"},
                {"mark": "verify(userRepository, never()).insert(any());", "title": "断言「没发生什么」同样重要", "text": "只断言抛了异常是不够的。失败路径必须验证「没有留下半条数据」，这才是事务意义的所在。", "rule": "TEST-UNIT-002"},
                {"mark": "@Mock\n    private UserRepository userRepository;", "title": "外部依赖全部 Mock", "text": "单测连真实数据库 = 测试不再是「单元」测试：慢、不稳定、且失败原因无法定位到具体代码。", "rule": "TEST-UNIT-004"},
            ],
        },
    ],
    "checklist": [
        "建表：执行 schema.sql，确认唯一索引与 idx_status_create_time 已建立",
        "确认 response 中有统一 ApiResponse 与全局异常处理器（只需一份，不要每个 Controller 各写各的）",
        "确认 pageSize 上限 100 与前端分页组件约定一致",
        "确认所有出参 DTO 的脱敏在 from() 中完成，且未暴露 password_hash",
        "确认 sort 字段走白名单（新增可排序字段时必须同步维护 ORDER_WHITELIST）",
        "补齐单测：正常路径 + 用户名重复 + 记录不存在 + 并发冲突，四条分支全覆盖",
        "前端联调前先确认错误码清单（USER_NOT_FOUND / USERNAME_TAKEN / USER_CONCURRENT_MODIFIED）",
    ],
    "pitfalls": [
        "漏 @Valid：DTO 上的约束注解会全部静默失效，且没有任何报错 —— 这是出现频率最高的一个坑。",
        "少 @Validated：类上不加，@PathVariable @Min(1) 就是一行装饰。",
        "@Transactional 不加 rollbackFor：默认只回滚运行时异常，改成受检异常后事务静默不回滚。",
        "Service 里直接拼 SQL：分层立刻失效，且注入风险集中在这一行。",
        "出参直接返回 Entity：加字段与泄字段变成同一个动作。",
    ],
    # 一个案例只有写清「什么时候不要用它」，才敢被当成蓝本复制。
    # 只讲优点的范例，会诱导人在错误场景照抄。
    "notSuitable": [
        "复杂报表 / 聚合统计：本案例按单表条件分页，多表 join + group by 应另开只读查询层，别往这套 CRUD 里塞。",
        "批量导入导出：逐条 insert 在万级以上会明显变慢，需要批处理与流式写出。",
        "一个实体上百个字段的超宽表：该先做表拆分，而不是把 DTO 写成一个大杂烩。",
        "读多写少且要求强一致的场景：先想清缓存与事务边界，再决定要不要套这套结构。",
    ],
    "performance": {
        "title": "分页查询的关键量级",
        "columns": ["关注点", "这套写法", "说明"],
        "rows": [
            ["单页上限", "pageSize ≤ 100", "DTO 上的 @Max 硬约束，防止一次拉全表打满带宽与内存"],
            ["可排序字段", "白名单枚举", "sort 走 ORDER_WHITELIST，避免任意字段排序击穿索引"],
            ["计数查询", "与列表同条件独立 count", "不查回全量再 size()，翻到最后一页也不会全表扫描"],
            ["并发写冲突", "乐观锁 + 版本号", "冲突时抛业务异常而非静默覆盖，前端可提示重新加载"],
        ],
        "conclusion": "这里给的是量级与机制，不是某台机器的实测数字。落地时请在真实数据量下压测，再回头调 pageSize 上限与索引。",
    },
    "references": [
        {"title": "阿里巴巴 Java 开发手册 · 工程规约与 MySQL 规约", "note": "分页、索引、唯一约束的出处"},
        {"title": "Spring Framework Reference · Validation, Data Binding, and Type Conversion", "url": "https://docs.spring.io/spring-framework/reference/core/validation/beanvalidation.html"},
        {"title": "Spring Data JPA Reference · Query Methods 与分页", "url": "https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html"},
        {"title": "军火库规则集 · WEB / SERVICE / DATA 三类", "note": "本案例每段代码的编号备注都指向对应规则"},
    ],
}
