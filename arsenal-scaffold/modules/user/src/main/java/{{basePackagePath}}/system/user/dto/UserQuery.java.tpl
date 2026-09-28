package {{basePackage}}.system.user.dto;

/**
 * 查询条件对象。参数超过三个就必须用对象承载 ——
 * 散着的参数每加一个条件就改一遍方法签名，所有调用方跟着改。
 *
 * 普通 class（不是 record）：Spring 按名字绑定 query 参数依赖 setter。
 */
public class UserQuery {

    private long page = 1;
    private long pageSize = 20;
    private String keyword;

    public long getPage() {
        return page;
    }

    public void setPage(long page) {
        this.page = Math.max(1, page);
    }

    public long getPageSize() {
        return pageSize;
    }

    public void setPageSize(long pageSize) {
        // 单页上限兜底：即便调用方传了 100000 也被限制住，防止一次查询拉全表
        this.pageSize = Math.min(Math.max(1, pageSize), 500);
    }

    public String getKeyword() {
        return keyword;
    }

    public void setKeyword(String keyword) {
        this.keyword = keyword;
    }
}
