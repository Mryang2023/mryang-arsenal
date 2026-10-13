package demo;

/**
 * 反例 fixture：故意编译不过。
 *
 * 活体解剖最容易骗人的一刻就是「起不来的工程」——
 * 如果采集器把它报成「健康/正常」，整张对账表就都不可信了。
 * 这个工程专门用来钉住那一条：它必须被报成 not-executed + 可读原因。
 */
public class BrokenApplication {
    public static void main(String[] args) {
        // 故意的语法错误：少一个分号 + 未定义的方法
        System.out.println("this line has no semicolon"
        undefinedMethod();
    }
}
