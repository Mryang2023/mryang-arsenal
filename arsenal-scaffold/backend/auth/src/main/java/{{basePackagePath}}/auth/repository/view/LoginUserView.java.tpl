package {{basePackage}}.auth.repository.view;

/**
 * 登录查询投影。只取登录需要的列 —— 密码哈希不进业务 DTO，
 * email/phone 等字段与登录无关，查出来也不该看到。
 *
 * 普通 POJO：原生 SQL 行映射与 MyBatis 驼峰自动映射都依赖 getter/setter。
 */
public class LoginUserView {

    private Long id;
    private String username;
    private String password;
    private String nickname;
    /** 状态：0 正常 1 停用 */
    private Integer status;

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

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }
}
