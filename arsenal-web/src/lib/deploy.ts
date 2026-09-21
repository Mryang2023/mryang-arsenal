import type { ComposedStack, StackPicks } from './content-types';
import { renderYaml } from './stack';

/**
 * 部署清单生成器：把「交付形态」这一维的选型落成可以直接 kubectl apply / docker compose up 的文件。
 *
 * 三条自我约束：
 *
 * ① **不为凑数生成**。这里的每一个文件都有人在某一天真的要改它 ——
 *    Dockerfile 换镜像、deployment 调副本、hpa 调阈值。写一堆空模板等于把
 *    「导出包是垃圾」这件事坐实。
 *
 * ② **内容跟着选型变，而不是给一份固定模板**。ConfigMap 的键来自各选项声明的 env，
 *    端口来自同一个 application.yml 绘制函数 —— 生成器不重复发明版本号与端口号。
 *    写成常量意味着「改了选型，部署清单不跟着变」，那是交付事故。
 *
 * ③ **Secret 不落值**。Secret 里放占位符，真正的凭据在部署时注入。
 *    生成一份带密码的文件交出去，等于教人把密钥提交进 Git。
 */

export interface DeployFile {
  /** 相对项目根的路径。与结构树里的节点名逐一对齐 */
  path: string;
  content: string;
  /** 生成来源，交付清单里要写明是谁带来的 */
  from?: string;
}

// ─────────────────────────────────────────────────────────────
// 从选型里算出来的事实
// ─────────────────────────────────────────────────────────────

/**
 * 应用端口。**从 application.yml 的绘制结果里读出来**，不在这里再写一遍 8080。
 * 画 yml 的函数是唯一的端口来源 —— 两边写死同一个数字时，改一处就会静默分叉。
 */
function serverPort(composed: ComposedStack): number {
  const m = /^\s{2}port:\s*(\d+)\s*$/m.exec(renderYaml(composed));
  return m ? Number(m[1]) : 8080;
}

/**
 * 应用侧的优雅停机超时：**从 application.yml 的绘制结果里读出来**。
 *
 * 不写死 30 —— 那是 Spring Boot 的默认值，不是这个项目的声明值。
 * 数据里改了超时而这里还是默认，两边就会静默分叉。
 */
function shutdownTimeout(composed: ComposedStack): number {
  const m = /timeout-per-shutdown-phase:\s*(\d+)s/.exec(renderYaml(composed));
  return m ? Number(m[1]) : 30;
}

/** 判断一个环境变量是不是凭据 —— 决定它进 ConfigMap 还是 Secret */
function isSecretKey(key: string): boolean {
  return /PASSWORD|SECRET|TOKEN|ACCESSKEY|PRIVATEKEY|CREDENTIAL/i.test(key);
}

/**
 * 把各选型声明的 env 分成「普通配置」与「凭据」两组。
 *
 * 为什么由选型提供而不是在这里写死一张配置项清单：
 * 选了 Redis 才会需要 SPRING_REDIS_HOST，选了消息队列才需要 broker 地址 ——
 * 这张表应该跟着选型长，而不是由生成器维护一份永远在追赶的长清单。
 */
function splitEnv(composed: ComposedStack) {
  const plain: { key: string; desc: string; from: string }[] = [];
  const secret: { key: string; desc: string; from: string }[] = [];
  const seen = new Set<string>(['SPRING_PROFILES_ACTIVE']);

  for (const e of composed.env) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    const item = { key: e.key, desc: e.desc, from: `${e.dimName} · ${e.optName}` };
    (isSecretKey(e.key) ? secret : plain).push(item);
  }
  return { plain, secret };
}

/** 依赖的中间件是否在本次选型里 —— Compose 里的 service 只看这个，不写 if-else */
function has(picks: StackPicks, dim: string, opts: string[]): boolean {
  const v = picks[dim];
  return !!v && opts.includes(v);
}

/**
 * 健康端点由「有没有 Actuator」决定 —— 这是选型里的事实，不是生成器的假设。
 *
 * Spring Boot 之所以有 /actuator/health，是因为引入了 Actuator；没选它的时候
 * 这个路径根本不存在，把它写进清单只会让 Pod 永远 NotReady、Compose 永远 unhealthy。
 * 那属于「产物看着专业、apply 上去起不来」，比老实说没有更糟。
 * 所以没有 Actuator 时给的是注释掉的骨架 + 一句怎么办，不假装端点存在。
 */
function probeEndpoints(picks: StackPicks): { readiness: string; liveness: string } | null {
  if (!has(picks, 'observability', ['actuator', 'prometheus'])) return null;
  return { readiness: '/actuator/health/readiness', liveness: '/actuator/health/liveness' };
}

/**
 * 探针段落。两种形态缩进一致，调用方不必知道自己拿到的是哪一种。
 * 没有健康端点时整段是注释 —— YAML 依然合法，kubectl/helm 也能直接跑。
 */
function probeBlock(indent: string, p: { readiness: string; liveness: string } | null): string {
  const at = (s: string) => indent + s;
  if (!p) {
    return [
      at('# ⚠️ 探针未启用：当前选型没有 Actuator，应用没有内置健康端点。'),
      at('#    写 /actuator/health 只会让 Pod 永远 NotReady —— 比不写更糟，所以这里不写。'),
      at('#    二选一：① 选型台把「可观测性」选成 actuator / prometheus 后重新导出；'),
      at('#    ② 自己暴露下面两个端点，然后把这几行注释打开。'),
      at('# readinessProbe:'),
      at('#   httpGet: { path: /health/ready, port: http }'),
      at('#   periodSeconds: 5'),
      at('#   failureThreshold: 3'),
      at('# livenessProbe:'),
      at('#   httpGet: { path: /health/live, port: http }'),
      at('#   periodSeconds: 15'),
      at('#   failureThreshold: 3'),
      at('# startupProbe:'),
      at('#   httpGet: { path: /health/live, port: http }'),
      at('#   periodSeconds: 5'),
      at('#   failureThreshold: 30'),
    ].join('\n');
  }
  return [
    at('readinessProbe:'),
    at('  httpGet:'),
    at(`    path: ${p.readiness}`),
    at('    port: http'),
    at('  periodSeconds: 5'),
    at('  timeoutSeconds: 2'),
    at('  failureThreshold: 3'),
    at('livenessProbe:'),
    at('  httpGet:'),
    at(`    path: ${p.liveness}`),
    at('    port: http'),
    at('  periodSeconds: 15'),
    at('  timeoutSeconds: 2'),
    at('  failureThreshold: 3'),
    at('startupProbe:'),
    at('  httpGet:'),
    at(`    path: ${p.liveness}`),
    at('    port: http'),
    at('  periodSeconds: 5'),
    at('  failureThreshold: 30'),
  ].join('\n');
}

interface ComposeService {
  name: string;
  /** 数据卷需要与否决定这句注释怎么写 */
  stateful: boolean;
  body: (appName: string) => string;
  /**
   * 应用是否要等它起来。
   *
   * prometheus 是唯一的反例：它是**来抓应用的**，而不是应用依赖的下游。
   * 把它也写进应用的 depends_on，就会形成 应用 → prometheus → 应用 的环，
   * docker compose 直接报 cycle detected，一套配置连起都起不来。
   */
  appDepends: boolean;
  /** 有健康检查的才能用 condition: service_healthy 等它真正可用 */
  healthy: boolean;
  /** 它是数据库时，给应用用的 JDBC URL —— 由选型决定，不写死 mysql */
  jdbc?: string;
}

/** Compose 里能一并带起来的中间件。哪些能放、哪些必须外部化，是这里唯一的一张表。 */
const COMPOSE_SERVICES: ComposeService[] = [
  {
    name: 'mysql',
    stateful: true,
    appDepends: true,
    healthy: true,
    jdbc: 'jdbc:mysql://mysql:3306/arsenal_demo?useUnicode=true&characterEncoding=utf8mb4',
    body: () =>
      [
        '  mysql:',
        '    image: mysql:8.0.36',
        '    # 必须显式指定字符集：默认的 latin1 会在写入中文或 emoji 时直接报错',
        '    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_general_ci',
        '    environment:',
        '      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD:-changeit}',
        '      MYSQL_DATABASE: arsenal_demo',
        '    ports: [ "3306:3306" ]',
        '    volumes:',
        '      - mysql-data:/var/lib/mysql',
        '    healthcheck:',
        '      test: [ "CMD", "mysqladmin", "ping", "-h", "127.0.0.1" ]',
        '      interval: 5s',
        '      retries: 20',
      ].join('\n'),
  },
  {
    name: 'postgres',
    stateful: true,
    appDepends: true,
    healthy: true,
    jdbc: 'jdbc:postgresql://postgres:5432/arsenal_demo',
    body: () =>
      [
        '  postgres:',
        '    image: postgres:16-alpine',
        '    environment:',
        '      POSTGRES_DB: arsenal_demo',
        '      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeit}',
        '    ports: [ "5432:5432" ]',
        '    volumes:',
        '      - pg-data:/var/lib/postgresql/data',
        '    healthcheck:',
        '      test: [ "CMD-SHELL", "pg_isready -U postgres" ]',
        '      interval: 5s',
        '      retries: 20',
      ].join('\n'),
  },
  {
    name: 'redis',
    stateful: true,
    appDepends: true,
    healthy: true,
    body: () =>
      [
        '  redis:',
        '    image: redis:7.2-alpine',
        '    # 给内存设上限：缓存容器不设限，会把宿主机内存吃干净',
        '    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru',
        '    ports: [ "6379:6379" ]',
        '    volumes:',
        '      - redis-data:/data',
        '    healthcheck:',
        '      test: [ "CMD", "redis-cli", "ping" ]',
        '      interval: 5s',
        '      retries: 10',
      ].join('\n'),
  },
  {
    name: 'nacos',
    stateful: true,
    appDepends: true,
    healthy: false,
    body: () =>
      [
        '  nacos:',
        '    image: nacos/nacos-server:v2.3.1',
        '    environment:',
        '      MODE: standalone',
        '      # 单机模式默认用内置 Derby，重启丢配置 —— 本地够用，别拿它当配置中心用',
        '    ports: [ "8848:8848", "9848:9848" ]',
        '    volumes:',
        '      - nacos-data:/home/nacos/data',
      ].join('\n'),
  },
  {
    name: 'rabbitmq',
    stateful: false,
    appDepends: true,
    healthy: false,
    body: () =>
      [
        '  rabbitmq:',
        '    image: rabbitmq:3.13-management-alpine',
        '    ports: [ "5672:5672", "15672:15672" ]',
        '    volumes:',
        '      - rabbit-data:/var/lib/rabbitmq',
      ].join('\n'),
  },
  {
    name: 'kafka',
    stateful: true,
    appDepends: true,
    healthy: false,
    body: () =>
      [
        '  kafka:',
        '    image: bitnami/kafka:3.7',
        '    # 单节点 KRaft：省掉一套 ZooKeeper，代价是不能做多节点故障演练',
        '    environment:',
        '      KAFKA_CFG_NODE_ID: "0"',
        '      KAFKA_CFG_PROCESS_ROLES: controller,broker',
        '      KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: "0@kafka:9093"',
        '      KAFKA_CFG_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093',
        '      KAFKA_CFG_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092',
        '      KAFKA_CFG_CONTROLLER_LISTENER_NAMES: CONTROLLER',
        '      KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
        '    ports: [ "9092:9092" ]',
        '    volumes:',
        '      - kafka-data:/bitnami/kafka',
      ].join('\n'),
  },
  {
    name: 'prometheus',
    stateful: false,
    // 它是来抓应用的，不是应用的下游 —— 放进 depends_on 会成环
    appDepends: false,
    healthy: false,
    body: (appName) =>
      [
        '  prometheus:',
        '    image: prom/prometheus:v2.51.2',
        '    volumes:',
        // 这个文件必须真的存在于 deploy/ 下。挂一个不存在的文件时，
        // Docker 会安静地创建一个**同名目录**挂进去，Prometheus 起不来，
        // 而报错是「配置文件是目录」—— 跟真实原因隔着一层。
        '      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro',
        '    ports: [ "9090:9090" ]',
        '    depends_on:',
        '      - ' + appName,
      ].join('\n'),
  },
];

/** 选型 → Compose 里的中间件服务。一张映射表，不在主体逻辑里写判断。 */
function composeServices(picks: StackPicks): ComposeService[] {
  const pick: { dim: string; opts: string[]; svc: string }[] = [
    { dim: 'database', opts: ['mysql'], svc: 'mysql' },
    { dim: 'database', opts: ['postgres'], svc: 'postgres' },
    { dim: 'cache', opts: ['redis'], svc: 'redis' },
    { dim: 'registry', opts: ['nacos'], svc: 'nacos' },
    { dim: 'mq', opts: ['rabbitmq'], svc: 'rabbitmq' },
    { dim: 'mq', opts: ['kafka'], svc: 'kafka' },
    { dim: 'observability', opts: ['prometheus'], svc: 'prometheus' },
  ];
  const names: string[] = [];
  for (const p of pick) if (has(picks, p.dim, p.opts)) names.push(p.svc);
  return COMPOSE_SERVICES.filter((s) => names.includes(s.name));
}

// ─────────────────────────────────────────────────────────────
// 各形态的文件
// ─────────────────────────────────────────────────────────────

function dockerfile(picks: StackPicks, composed: ComposedStack): string {
  const gradle = picks.build === 'gradle';
  const javaVersion = composed.properties['java.version'] ?? '17';
  // 构建阶段用官方 maven / gradle 镜像，而不是 ./mvnw、./gradlew。
  //
  // 这不是偷懒：导出包里只有 pom.xml 与 src —— 没有 .mvn/ 也没有 wrapper 脚本，
  // 写 ./mvnw 会让第一次 docker build 就挂在 `./mvnw: not found` 上。
  // 与其为了一句 wrapper 去生成一堆二进制脚本，不如让构建工具由镜像提供：
  // 运行阶段仍然是纯 JRE，编译器依然不会进生产镜像。
  const build = gradle
    ? [
        'COPY build.gradle settings.gradle ./',
        // 先只复制构建脚本再解析依赖：改一行业务代码不会让依赖层失效
        'RUN gradle --no-daemon dependencies || true',
        'COPY src ./src',
        'RUN gradle --no-daemon bootJar',
        // Gradle 没有 layertools 的等价物，多阶段只能拆到「依赖 / 业务」的粒度
        'RUN mkdir -p /build/extracted && cp build/libs/*.jar app.jar',
      ].join('\n')
    : [
        'COPY pom.xml ./',
        'RUN mvn -B -q dependency:go-offline || true',
        'COPY src ./src',
        'RUN mvn -B -q clean package -DskipTests \\',
        ' && java -Djarmode=layertools -jar target/*.jar extract --destination target/extracted',
      ].join('\n');
  // --chown 不是洁癖：USER app 之后再 COPY，文件属主是 root，
  // 应用连一个临时文件都写不了 —— 表现为某些库静默失败，而不是明确报权限错。
  const copyLayers = gradle
    ? 'COPY --chown=app:app --from=builder /build/app.jar app.jar'
    : [
        'COPY --chown=app:app --from=builder /build/target/extracted/dependencies/ ./',
        'COPY --chown=app:app --from=builder /build/target/extracted/spring-boot-loader/ ./',
        'COPY --chown=app:app --from=builder /build/target/extracted/snapshot-dependencies/ ./',
        'COPY --chown=app:app --from=builder /build/target/extracted/application/ ./',
      ].join('\n');
  const entry = gradle
    ? 'ENTRYPOINT [ "java", "-jar", "app.jar" ]'
    : 'ENTRYPOINT [ "java", "org.springframework.boot.loader.launch.JarLauncher" ]';

  return `# 由「杨先生的军火库 · 架构装配台」按当前选型生成。
# 两个阶段的职责严格分开：构建阶段只要 JDK，运行阶段只装 JRE。
# 运行镜像里出现 javac / maven，等于把一个编译器放到了生产网络上。
#
# Java ${javaVersion} · ${gradle ? 'Gradle' : 'Maven'}

# ── ① 构建阶段 ─────────────────────────────────────────────
# 构建工具由镜像提供。导出包里没有 wrapper 脚本，指望 ./mvnw 会让首次构建直接失败。
FROM ${gradle ? `gradle:8-jdk${javaVersion}-jammy` : `maven:3.9-eclipse-temurin-${javaVersion}`} AS builder
WORKDIR /build
${build}

# ── ② 运行阶段 ─────────────────────────────────────────────
FROM eclipse-temurin:${javaVersion}-jre-jammy
RUN groupadd -r app && useradd -r -g app app
WORKDIR /app

# 按变更频率从低到高 COPY：依赖层几乎每次命中缓存，
# 改一行业务代码不会触发几百 MB 依赖重新推送。
${copyLayers}

USER app
EXPOSE ${serverPort(composed)}
# MaxRAMPercentage 必须显式给：不写等于让 JVM 自以为是地判断能占多少，
# 而它被 kill 的原因通常正是吃到了容器 limit 之外。
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0 -XX:+UseG1GC -Djava.security.egd=file:/dev/./urandom"
${entry}

# 不要把 application-prod.yml 打进镜像。
# 镜像应当与部署环境无关 —— 换环境只换环境变量，不重新构建。
`;
}

function dockerignore(): string {
  return `# 少了这个文件，docker build 会把整个目录推给守护进程：
# target/、.git/、日志全进构建上下文，构建时间能从 10 秒变成 2 分钟。
target/
build/
.git/
.gitignore
.idea/
.vscode/
*.log
logs/
deploy/
docs/
*.md
!README.md
`;
}

function composeFile(
  appName: string,
  picks: StackPicks,
  composed: ComposedStack
): string {
  const port = serverPort(composed);
  const services = composeServices(picks);
  // 只等**应用真的依赖**的服务，并且只对有健康检查的用 service_healthy：
  // 短语法的 depends_on 只保证「容器起来了」，不保证「能连上」——
  // 于是应用会先启动、连不上库、打一屏连接错误，然后才靠重试缓过来。
  const deps = services.filter((s) => s.appDepends);
  const depList = deps.length
    ? deps
        .map(
          (s) =>
            `      ${s.name}:\n        condition: ${s.healthy ? 'service_healthy' : 'service_started'}`
        )
        .join('\n')
    : '      # 当前选型没有需要等待的中间件';
  const volList = [...new Set(services.filter((s) => s.stateful).map((s) => `${s.name}-data:`))]
    .map((v) => `  ${v}\n    driver: local`)
    .join('\n');
  // JDBC URL 由选型决定。写死 mysql 的话，选了 postgres 会得到一个
  // 连 mysql://mysql:3306 的应用，而 compose 里根本没有叫 mysql 的主机 ——
  // 报出来是 UnknownHostException，很难联想到是生成器抄错了。
  const jdbc = services.find((s) => s.jdbc)?.jdbc;
  const bodies = services.map((s) => s.body(appName)).join('\n\n');
  const p = probeEndpoints(picks);
  const healthcheck = p
    ? [
        '',
        '    healthcheck:',
        `      test: [ "CMD-SHELL", "wget -qO- http://127.0.0.1:${port}${p.liveness.replace('/liveness', '')} || exit 1" ]`,
        '      interval: 15s',
        '      timeout: 3s',
        '      retries: 10',
        '      # start_period 是给慢启动应用的缓冲：没有它，启动期就会被判失败并反复重启',
        '      start_period: 40s',
      ].join('\n')
    : [
        '',
        '    # ⚠️ 健康检查未启用：当前选型没有 Actuator，应用没有内置健康端点。',
        '    #    写 /actuator/health 会让容器永远 unhealthy —— 比不写更糟。',
        '    #    需要时：选型台把「可观测性」选成 actuator / prometheus 后重新导出，',
        '    #    或自己暴露一个端点再打开下面几行。',
        '    # healthcheck:',
        '    #   test: [ "CMD-SHELL", "wget -qO- http://127.0.0.1:PORT/health || exit 1" ]',
        '    #   interval: 15s',
        '    #   start_period: 40s',
      ].join('\n');

  return `# ${appName} · 本地与联调环境
#
# 定位：让「换台机器也能跑起来」成立。它不是生产调度器 ——
# 机器重启策略、跨机迁移、健康检查后的自动替换都不在它的职责里。
# 生产环境的数据库请用独立实例或托管服务；这里的数据库容器无高可用、无备份。
services:
  ${appName}:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    image: ${appName}:local
    environment:
      SPRING_PROFILES_ACTIVE: dev${
        jdbc
          ? '\n      # 容器里主机名就是服务名 —— 写 IP 会在重建容器后失效\n' +
            `      SPRING_DATASOURCE_URL: ${jdbc}`
          : ''
      }
    ports:
      - "${port}:${port}"
    depends_on:
${depList}
    restart: unless-stopped${healthcheck}
${bodies ? '\n' + bodies : ''}
${volList ? '\nvolumes:\n' + volList : ''}
`;
}

/**
 * Prometheus 抓取配置。选了 prometheus 就必须有它 —— 容器挂载的文件不存在时
 * Docker 会建一个同名目录挂进去，Prometheus 起不来，报错还完全不像真正的原因。
 */
function prometheusYml(appName: string, port: number, metricsPath: string): string {
  return `# 抓取配置。由「杨先生的军火库 · 架构装配台」按当前选型生成。
#
# 只有一条 job：抓应用自己暴露的指标端点。
# 这里用服务名而不是 IP —— 容器重建后 IP 会变，服务名不会。
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: ${appName}
    metrics_path: ${metricsPath}
    static_configs:
      - targets: [ "${appName}:${port}" ]
    # 抓取超时必须小于抓取间隔，否则上一轮没结束下一轮又开始，任务会堆积
    scrape_timeout: 10s
`;
}

function makefile(appName: string, picks: StackPicks): string {
  const k8s = picks.deploy === 'k8s';
  const helm = picks.deploy === 'helm';
  const compose = picks.deploy === 'docker';
  // -k 而不是 -f：kustomization.yaml 里的 namespace 只有在 kustomize 模式下才生效。
  // 用 -f 逐个 apply，资源会全部落到 default 命名空间，而文件里明明写着 namespace ——
  // 两边看着都对，Pod 却在另一个命名空间里，很难查。
  const deployCmd = k8s
    ? 'kubectl apply -k deploy/k8s/'
    : helm
      ? 'helm upgrade --install $(APP) deploy/chart -f deploy/chart/values.yaml'
      : 'docker compose -f deploy/docker-compose.yml up -d';

  // 本地起停只在 docker 形态存在 —— k8s / helm 形态压根不生成 compose 文件，
  // 留着这两个 target 等于给人一条必然失败的命令。
  const local = compose
    ? [
        '',
        'up:              ## 本地起全套（应用 + 依赖中间件）',
        '\tdocker compose -f deploy/docker-compose.yml up -d',
        '',
        'down:            ## 停掉本地全套',
        '\tdocker compose -f deploy/docker-compose.yml down',
      ].join('\n')
    : '';

  // 回滚与查状态只在集群形态有意义
  const cluster = k8s || helm
    ? [
        '',
        'rollback:        ## 回滚上一个版本。注意：这只回滚镜像，不回滚数据库',
        '\tkubectl rollout undo deployment/$(APP)',
        '',
        'status:          ## 看当前副本状态与就绪情况',
        '\tkubectl get pods -l app=$(APP) -w',
      ].join('\n')
    : '';

  const phony = ['image', 'push', 'apply', 'help', ...(compose ? ['up', 'down'] : []),
    ...(k8s || helm ? ['rollback', 'status'] : [])].join(' ');

  return `# 把最常敲的几条命令固化下来。
#
# 为什么值得单独有个 Makefile：发布步骤一旦变成「照着群里那段命令改一改」，
# 就一定会出现「某个人记的版本不一样」。把它变成文件中的 target，
# 差异就只存在于参数，不再存在于步骤。
#
# target 是**按交付形态裁剪**的：没有 compose 文件就不给 up / down，
# 不在集群里跑就不给 rollback。给一条必然失败的命令，比不给更糟。
APP        ?= ${appName}
REGISTRY   ?= registry.example.com
# 没有 git 的目录里 TAG 会是空的，镜像 tag 变成 registry/app: —— 兜一个 newest
TAG        ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo newest)
IMAGE      := $(REGISTRY)/$(APP):$(TAG)

.PHONY: ${phony}

help:            ## 列出所有命令
\t@grep -E '^[a-z-]+:' Makefile | sed 's/://' | sort

image:           ## 构建镜像（tag 取当前 commit）
\tdocker build -f deploy/Dockerfile -t $(IMAGE) .

push: image     ## 构建并推送
\tdocker push $(IMAGE)

apply:           ## 部署到目标环境
\t$(DEPLOY_CMD)${local}${cluster}
`.replace('$(DEPLOY_CMD)', deployCmd);
}

function systemdUnit(appName: string, composed: ComposedStack): string {
  return `# ${appName} · 进程守护
#
# 两条参数比启动命令本身更重要，写错其中任何一条都会在发布时随机丢请求：
#   KillSignal=SIGTERM   —— Spring Boot 只有收到它才会走优雅停机；SIGKILL 会直接掐断进行中的请求
#   TimeoutStopSec       —— 必须大于 spring.lifecycle.timeout-per-shutdown-phase
#                           （当前为 ${shutdownTimeout(composed)}s，读自 application.yml），
#                           否则 systemd 会在应用处理完存量请求之前动手
[Unit]
Description=${appName}
After=network.target

[Service]
Type=simple
User=appuser
Group=appuser
WorkingDirectory=/opt/${appName}
Environment="JAVA_OPTS=-Xms512m -Xmx1g -XX:+UseG1GC"
Environment="SPRING_PROFILES_ACTIVE=prod"
ExecStart=/usr/bin/java $JAVA_OPTS -jar /opt/${appName}/app.jar
SuccessExitStatus=143

KillSignal=SIGTERM
TimeoutStopSec=${gracePeriod(composed)}s
Restart=always
RestartSec=5
# 手工 kill -9 之后不再自动拉起：滚动发布要的就是这个效果
RestartPreventExitStatus=137

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${appName}

[Install]
WantedBy=multi-user.target

# 应用监听 ${serverPort(composed)} —— 端口来自 application.yml，改动时两处都要同步。
`;
}

// ─────────────────────────────────────────────────────────────
// Kubernetes 原生清单
// ─────────────────────────────────────────────────────────────

interface K8sCtx {
  app: string;
  port: number;
  image: string;
  replicas: number;
  /** 优雅停机总时长，由 application.yml 里的应用侧超时算出来 */
  grace: number;
  /** 没有 Actuator 就是 null —— 那时探针段落整段是注释，不伪造端点 */
  probes: { readiness: string; liveness: string } | null;
  plain: { key: string; desc: string }[];
  secret: { key: string; desc: string }[];
}

function configMap(c: K8sCtx): string {
  const data = c.plain.length
    ? c.plain
        .map((e) => `  # ${e.desc}\n  ${e.key}: "${placeholderOf(e.key)}"`)
        .join('\n')
    : '  # 当前选型没有声明非敏感环境变量\n  # 空的 ConfigMap 不会被 Deployment 引用，留在此处是为了让后来的改动有地方落脚\n  SPRING_PROFILES_ACTIVE: "prod"';
  return `# 非敏感配置。
#
# 镜像与环境解耦的落点就在这里：换环境只改 ConfigMap，不重新构建镜像。
# 把环境相关的配置打进镜像，等于让同一个 tag 在不同环境有不同内容 ——
# 那之后「这个镜像跑的是哪一版配置」就没有答案了。
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
data:
  SPRING_PROFILES_ACTIVE: "prod"
${data}
`;
}

function secretDoc(c: K8sCtx): string {
  const keys = c.secret.length
    ? c.secret
        .map(
          (e) =>
            `  # ${e.desc}\n` +
            `  # 留空是刻意的：真正的凭据在部署时注入，不进 Git。\n` +
            `  ${e.key}: ""`
        )
        .join('\n')
    : '  # 当前选型没有声明凭据类变量\n  # 若之后引入，一律放 Secret —— Secret 进 Git 等于把凭据交出去\n  PLACEHOLDER: ""';
  return `# 敏感配置模板。
#
# ⚠️ 这个文件里的值是空的，并且应当保持为空。
# Secret 是 base64 而非加密 —— 把真值写进去再提交，等于把凭据交给所有能读仓库的人。
# 正确的注入方式（三选一）：
#   ① kubectl create secret generic ${c.app} --from-literal=KEY=VALUE（不在配置文件里留值）
#   ② External Secrets / Sealed Secrets 从密钥管理系统同步
#   ③ CI 在部署阶段注入，本文件始终只作为「需要哪些键」的说明书
apiVersion: v1
kind: Secret
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
type: Opaque
stringData:
${keys}
`;
}

/** 给配置项一个可运行的占位值 —— 空值会让应用起不来，真值又不能给 */
function placeholderOf(key: string): string {
  if (/URL|HOST|ADDR/i.test(key)) return 'CHANGE_ME';
  if (/PORT/i.test(key)) return 'CHANGE_ME';
  if (/USER/i.test(key)) return 'CHANGE_ME';
  return 'CHANGE_ME';
}

function deployment(c: K8sCtx): string {
  const envFrom = [
    '          envFrom:',
    '            - configMapRef:',
    `                name: ${c.app}`,
    '            - secretRef:',
    `                name: ${c.app}`,
  ].join('\n');
  return `# Deployment：副本数、资源、探针、优雅停机，四件事缺一项都会有一类故障没人管。
#
# 探针的三个角色各不相同，不要互相代替：
#   readiness   不就绪就从 Service 里摘掉 —— 缺它，发布期会出现随机 502
#   liveness    进程僵死时重启 —— 缺它，死锁永远不会被发现（进程还在）
#   startupProbe 给慢启动的应用一个缓冲窗口 —— 缺它，启动慢会被 liveness 反复重启
#
# ⚠️ 探针里不要查数据库：一次库抖动会让所有副本同时被判不健康并一起重启，
#    把下游的一次抖动放大成全集群雪崩。探针只许反映自己进程的可用性。
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
spec:
  replicas: ${c.replicas}
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0        # 滚动期间一个都不许少 —— 少了就等于拿可用性换发布速度
      maxSurge: 1
  selector:
    matchLabels:
      app: ${c.app}
  template:
    metadata:
      labels:
        app: ${c.app}
    spec:
      # 优雅停机的总时长必须大于应用侧超时，否则等于没配：
      # 应用侧 timeout-per-shutdown-phase=${c.grace - 15}s（读自 application.yml），
      # 这里是整条链路的总预算，必须比它大 —— 相等就等于没给信号传播留时间
      terminationGracePeriodSeconds: ${c.grace}
      serviceAccountName: ${c.app}
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        fsGroup: 10001
      containers:
        - name: ${c.app}
          image: ${c.image}
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: ${c.port}
          resources:
            # requests 是调度依据，limits 是天花板。
            # 只写 limits 不写 requests，调度器会把 Pod 放到其实装不下它的节点上。
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: "2"
              memory: 2Gi
${envFrom}
${probeBlock('          ', c.probes)}
          lifecycle:
            preStop:
              exec:
                # Pod 被摘除 endpoint 与进程收到 SIGTERM 之间有一个传播窗口。
                # 这段 sleep 就是那个窗口 —— 省掉它，每次滚动更新都会掉一批请求。
                command: [ "sh", "-c", "sleep 5" ]
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: false
            capabilities:
              drop: [ "ALL" ]
`;
}

/**
 * 优雅停机的**总时长** = 应用侧超时 + 余量。
 *
 * 余量是必须的：K8s 的 terminationGracePeriodSeconds 是这条链路的总预算
 * （发 SIGTERM → 等应用收尾 → 到点 SIGKILL），而应用侧那 30s 只是它自己收尾的预算。
 * 两者相等就等于没有给「发信号到进程收到」这段传播留时间，
 * 表现为每次滚动更新随机掉几个请求 —— 而且只在发布时发生，平时完全正常。
 */
function gracePeriod(composed: ComposedStack): number {
  return shutdownTimeout(composed) + 15;
}

function service(c: K8sCtx): string {
  return `# Service 给一组不断被替换的 Pod 一个稳定的 DNS 名。
# Pod 的 IP 每次重建都会变 —— 直接连 Pod IP 的配置，在第一次滚动更新后就会失效。
apiVersion: v1
kind: Service
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
spec:
  type: ClusterIP
  selector:
    app: ${c.app}
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
`;
}

/**
 * Helm 版的 Service。
 *
 * 不能拿原生 service() 做字符串替换 —— 试过，`.replace(/^name: .*$/m, ...)` 匹配不到
 * 带缩进的 `  name:`，结果是名字与 selector 全是写死的：Deployment 用 fullname、
 * Service 用裸名，装完 Service 选不到 Pod、Ingress 指向不存在的后端，
 * 而且没有任何报错，只是流量永远进不来。模板就必须照模板写。
 */
function chartService(): string {
  return `# Service 给一组不断被替换的 Pod 一个稳定的 DNS 名。
# Pod 的 IP 每次重建都会变 —— 直接连 Pod IP 的配置，在第一次滚动更新后就会失效。
apiVersion: v1
kind: Service
metadata:
  name: {{ include "%APP%.fullname" . }}
  labels:
    {{- include "%APP%.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  selector:
    {{- include "%APP%.selectorLabels" . | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.targetPort }}
      protocol: TCP
`;
}

function ingress(c: K8sCtx): string {
  return `# 外部流量入口。需要集群里已装 Ingress Controller。
#
# 若由网关层统一收 Web 流量，这个文件通常不需要 —— 删掉它比留一个没人用的对象更清楚。
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: 8m
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
spec:
  ingressClassName: nginx
  rules:
    - host: ${c.app}.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${c.app}
                port:
                  name: http
  # TLS 证书由 cert-manager 签发时写在这里：
  # tls:
  #   - hosts: [ ${c.app}.example.com ]
  #     secretName: ${c.app}-tls
`;
}

function hpa(c: K8sCtx): string {
  return `# HPA 依赖 Metrics Server：集群里没装的话，这个文件会被创建但永远不知道该扩不该扩。
#
# maxReplicas 是必须写死的上限。不设上限的扩容会把压力转嫁给下游 ——
# 数据库连接数是「副本数 × 池大小」，扩容这个动作本身可能先把数据库推到上限。
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${c.app}
  minReplicas: ${Math.max(2, c.replicas)}
  maxReplicas: ${Math.max(4, c.replicas * 3)}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    # JVM 的堆一旦吃掉内存就不会还给操作系统（G1 只在 GC 后归还，且很保守），
    # 所以 memory utilization 是**单调上升**的：它会把副本顶上去，然后永远不缩回来。
    # 要用内存做扩缩依据，得改用「堆使用率」这类业务指标（Prometheus Adapter）。
    # - type: Resource
    #   resource:
    #     name: memory
    #     target:
    #       type: Utilization
    #       averageUtilization: 80
  behavior:
    scaleUp:
      # 扩容要快，救的是可用性 —— 所以这里**不设** stabilizationWindow（默认 0，立即生效）。
      # 曾经写 60，注释说着「要快」、配置却在压着它等一分钟，两条互相打架。
      # 防抖动交给下面的步长上限，不要拿延迟扩容去换。
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      # 缩容要慢，防的是抖动 —— 一分钟内反复扩缩比一直多跑两个副本更贵
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 300
`;
}

function pdb(c: K8sCtx): string {
  return `# PodDisruptionBudget：一次节点排水能同时赶走几个副本。
#
# 没有它，kubectl drain 会一次性把全部副本迁走 —— 所谓的「滚动更新」名存实亡，
# 表现为节点维护期间服务整体不可用，而 Deployment 自己完全无辜。
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
spec:
  minAvailable: ${Math.max(1, c.replicas - 1)}
  selector:
    matchLabels:
      app: ${c.app}
`;
}

function serviceAccount(c: K8sCtx): string {
  return `# 独立的运行身份。用 default ServiceAccount 意味着这个 Pod 的权限由命名空间默认值决定，
# 而大多数集群的 default SA 权限都偏松 —— 出现 Cannot list resources 时还能跑，
# 出现不该有的写权限时则没人会发现。
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
automountServiceAccountToken: false
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
rules:
  # 最小权限：只读自己需要的两种内生资源。需要更多时在这里加，不要直接给 cluster-admin
  - apiGroups: [ "" ]
    resources: [ "configmaps" ]
    verbs: [ "get", "list", "watch" ]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${c.app}
subjects:
  - kind: ServiceAccount
    name: ${c.app}
`;
}

function kustomization(c: K8sCtx): string {
  return `# apply 顺序的唯一来源。
#
# 为什么不让人 kubectl apply -f deploy/k8s/ *.yaml：
# 那个命令的顺序取决于文件系统的返回顺序，而 ConfigMap/Secret 必须先于 Deployment 存在 ——
# 顺序反了不会报错（Deployment 会起来然后 CrashLoop），但会出现一次没有必要的失败。
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${c.app}
resources:
  - 00-namespace.yaml
  - 01-configmap.yaml
  - 02-secret.yaml
  - 03-serviceaccount.yaml
  - 04-deployment.yaml
  - 05-service.yaml
  - 06-ingress.yaml
  - 07-hpa.yaml
  - 08-pdb.yaml
# 多环境从这里长出去：
#   overlays/dev、overlays/prod 各放一份 kustomization.yaml，
#   kubectl apply -k overlays/prod
`;
}

function namespace(c: K8sCtx): string {
  return `# 命名空间是配额与权限的边界 —— 一个 namespace 一个应用，
# 资源配额与网络策略才能精确到这个应用而不是整个集群。
apiVersion: v1
kind: Namespace
metadata:
  name: ${c.app}
  labels:
    app: ${c.app}
`;
}

// ─────────────────────────────────────────────────────────────
// Helm Chart
// ─────────────────────────────────────────────────────────────

function chartYaml(app: string): string {
  return `# version    是 **chart 自身**的版本。模板改了才动它。
# appVersion 是**应用镜像**的版本。业务代码改了才动它。
# 两者混在一个数字里，就永远答不出「这次发布到底变了什么」。
apiVersion: v2
name: ${app}
description: ${app} —— 由「杨先生的军火库 · 架构装配台」按当前选型生成
type: application
version: 0.1.0
appVersion: "1.0.0"
`;
}

/**
 * 主 values。
 *
 * env 段由选型声明的非敏感变量填充 —— 选了 Redis 才有 REDIS_HOST，
 * 选了消息队列才有 broker 地址。写死一行 SPRING_PROFILES_ACTIVE 的话，
 * chart 装上去也连不上任何中间件，而错误要等到运行时才暴露。
 */
function values(app: string, port: number, plain: { key: string; desc: string }[], grace: number): string {
  const env = [
    '  # 由选型生成：每一项都能追溯到某个选中的中间件',
    '  SPRING_PROFILES_ACTIVE: prod',
    ...plain.map((e) => `  # ${e.desc}\n  ${e.key}: "CHANGE_ME"`),
  ].join('\n');
  return `# 所有环境共享的默认值。每份 values-<env>.yaml 只写在它之上的**差值**，
# 不要复制整份再改 —— 那样改一处要改三处，迟早有一处忘掉。
replicaCount: 2

image:
  repository: registry.example.com/${app}
  pullPolicy: IfNotPresent
  # 不要在 values 里写具体业务版本号：这里放一个稳定的引用，
  # 实际的 tag 由部署流水线 --set image.tag=<commitSha> 注入
  tag: "latest"

service:
  type: ClusterIP
  port: 80
  targetPort: ${port}

resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: "2"
    memory: 2Gi

# 优雅停机总时长。必须大于应用侧 spring.lifecycle.timeout-per-shutdown-phase
terminationGracePeriodSeconds: ${grace}

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 6
  targetCPUUtilizationPercentage: 70

ingress:
  enabled: false
  className: nginx
  host: ${app}.example.com
  tls: false

# 中断预算。默认关：单副本时开它只会让节点永远排不空
podDisruptionBudget:
  enabled: false
  minAvailable: 1

# 只有非敏感配置写在这里。凭据要么由 External Secrets 同步，
# 要么在部署时注入 —— Helm 不会替你屏蔽任何东西，
# 写进 values 的值会出现在 helm get values 的输出与 release 历史里。
env:
${env}
`;
}

/**
 * Helm 版的 Secret。
 *
 * 只给**键**，不给值，而且不挂在 values 上 —— values 会出现在 `helm get values`
 * 与 release 历史里，把凭据塞进去等于把它交给了每个有集群读权限的人。
 * 键位来自选型声明的凭据类环境变量，值留给部署时注入。
 */
function chartSecret(secret: { key: string; desc: string }[]): string {
  const keys = secret.length
    ? secret
        .map((e) => `  # ${e.desc}\n  # 留空是刻意的：真值在部署时注入，不进 Git。\n  ${e.key}: ""`)
        .join('\n')
    : '  # 当前选型没有声明凭据类变量\n  # 若之后引入，一律走 External Secrets 或部署时注入，不要写进 values\n  PLACEHOLDER: ""';
  return `# 敏感配置模板。
#
# ⚠️ 这个文件里的值必须保持为空。Secret 是 base64 而非加密 ——
# 把真值写进去再提交，等于把凭据交给所有能读仓库的人。
# 正确的注入方式（三选一）：
#   ① kubectl create secret generic <release> --from-literal=KEY=VALUE
#   ② External Secrets / Sealed Secrets 从密钥管理系统同步
#   ③ CI 在部署阶段注入，本文件始终只作为「需要哪些键」的说明书
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "%APP%.fullname" . }}
  labels:
    {{- include "%APP%.labels" . | nindent 4 }}
type: Opaque
stringData:
${keys}
`;
}

function chartServiceAccount(): string {
  return `# 运行身份。用 default ServiceAccount 等于让这个应用继承命名空间里的默认权限。
#
# automountServiceAccountToken: false —— 应用不调 K8s API 时不挂 token，
# 少一个可被拿走的凭据。确实要调 API 时再显式打开并配 Role。
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "%APP%.fullname" . }}
  labels:
    {{- include "%APP%.labels" . | nindent 4 }}
automountServiceAccountToken: false
`;
}

function chartPdb(): string {
  return `{{- if .Values.podDisruptionBudget.enabled }}
# 中断预算：一次节点排水最多能同时赶走几个副本。
#
# 没有它，kubectl drain 会一次性把全部副本迁走 —— 所谓的「滚动更新」名存实亡，
# 表现为节点维护期间服务整体不可用，而 Deployment 自己完全无辜。
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "%APP%.fullname" . }}
  labels:
    {{- include "%APP%.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "%APP%.selectorLabels" . | nindent 6 }}
{{- end }}
`;
}

function valuesDev(app: string): string {
  return `# 开发环境：一份资源、不开扩缩、latest 也能接受
replicaCount: 1

image:
  tag: "dev"

resources:
  requests: { cpu: 200m, memory: 512Mi }
  limits:   { cpu: "1",  memory: 1Gi }

autoscaling:
  enabled: false

env:
  SPRING_PROFILES_ACTIVE: dev
`;
}

function valuesProd(): string {
  return `# 生产环境：多副本、有 PDB、有扩缩上限、启用外部 Ingress
replicaCount: 3

resources:
  requests: { cpu: 500m, memory: 1Gi }
  limits:   { cpu: "2",  memory: 2Gi }

autoscaling:
  enabled: true
  minReplicas: 3
  # maxReplicas 是硬性天花板：副本数 × 连接池大会打到达梦/MySQL 的连接上限
  maxReplicas: 6
  targetCPUUtilizationPercentage: 70

podDisruptionBudget:
  enabled: true
  minAvailable: 2

ingress:
  enabled: true
  host: REPLACE_ME.example.com
  tls: true

env:
  SPRING_PROFILES_ACTIVE: prod
`;
}

function helpersTpl(app: string): string {
  return `{{/* 命名与标签的统一定义。
所有资源的名字与 label 都必须走这里：散着写会出现
「Deployment 的 selector 与 Service 的 selector 差一个字符」—— Service 选不到 Pod，
而且不会有任何报错，只是流量永远进不来。 */}}

{{- define "${app}.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "${app}.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "${app}.labels" -}}
app: {{ include "${app}.fullname" . }}
app.kubernetes.io/name: {{ include "${app}.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "${app}.selectorLabels" -}}
app: {{ include "${app}.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
`;
}

function chartDeployment(port: number, probes: { readiness: string; liveness: string } | null): string {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "%APP%.fullname" . }}
  labels:
    {{- include "%APP%.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      {{- include "%APP%.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "%APP%.selectorLabels" . | nindent 8 }}
    spec:
      # 优雅停机的总时长必须大于应用侧超时，否则等于没配
      terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}
      serviceAccountName: {{ include "%APP%.fullname" . }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        fsGroup: 10001
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: ${port}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          env:
            {{- range $k, $v := .Values.env }}
            - name: {{ $k }}
              value: {{ $v | quote }}
            {{- end }}
${probeBlock('          ', probes)}
          lifecycle:
            preStop:
              exec:
                command: [ "sh", "-c", "sleep 5" ]
`;
}

function chartIngress(): string {
  return `{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "%APP%.fullname" . }}
  labels:
    {{- include "%APP%.labels" . | nindent 4 }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  {{- if .Values.ingress.tls }}
  tls:
    - hosts: [ {{ .Values.ingress.host | quote }} ]
      secretName: {{ include "%APP%.fullname" . }}-tls
  {{- end }}
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "%APP%.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}
`;
}

function chartConfigMap(): string {
  return `# 非敏感配置。
#
# ⚠️ 只放非敏感项。Helm 不会替你屏蔽任何东西 —— 写在这里的值会出现在
# helm get values 的输出里，也会进 release 历史。
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "%APP%.fullname" . }}
  labels:
    {{- include "%APP%.labels" . | nindent 4 }}
data:
  {{- range $k, $v := .Values.env }}
  {{ $k }}: {{ $v | quote }}
  {{- end }}
`;
}

function chartHpa(): string {
  return `{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "%APP%.fullname" . }}
  labels:
    {{- include "%APP%.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "%APP%.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  # 上限是硬性天花板：副本数 × 连接池大会先把数据库推到连接数上限
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
{{- end }}
`;
}

// ─────────────────────────────────────────────────────────────
// 对外入口
// ─────────────────────────────────────────────────────────────

export interface DeployOpts {
  /** 应用名，同时用作镜像名、Deployment 名与命名空间名 */
  appName?: string;
}

/**
 * 生成部署清单。
 *
 * 返回的文件名与结构树里的节点逐一对齐 —— 两边任何一边多了少了，
 * 都会让用户照着图找不到文件。对齐这件事由 `npm run verify:project` 断言。
 */
export function buildDeployPlan(
  picks: StackPicks,
  composed: ComposedStack,
  opts: DeployOpts = {}
): DeployFile[] {
  const app = opts.appName ?? 'arsenal-demo';
  const port = serverPort(composed);
  const { plain, secret } = splitEnv(composed);
  const ctx: K8sCtx = {
    app,
    port,
    image: `registry.example.com/${app}:1.0.0`,
    // 默认给 2 副本：replicas=1 没有滚动更新的余地，发布等于停机
    replicas: 2,
    grace: gracePeriod(composed),
    probes: probeEndpoints(picks),
    plain,
    secret,
  };
  const out: DeployFile[] = [];
  const push = (path: string, content: string, from?: string) =>
    out.push({ path, content, from });

  const dockerized = ['docker', 'k8s', 'helm'].includes(picks.deploy);

  if (dockerized) {
    push('deploy/Dockerfile', dockerfile(picks, composed), '交付形态');
    push('deploy/.dockerignore', dockerignore(), '交付形态');
    push('deploy/Makefile', makefile(app, picks), '交付形态');
  }
  if (picks.deploy === 'docker') {
    push('deploy/docker-compose.yml', composeFile(app, picks, composed), '交付形态 · Docker');
    // compose 里挂了这个文件，就必须一起生成 —— 少一个文件，prometheus 容器起不来
    if (has(picks, 'observability', ['prometheus'])) {
      // 选了 prometheus 就一定有 actuator（micrometer 的端点挂在 /actuator 下）
      push('deploy/prometheus.yml', prometheusYml(app, port, '/actuator/prometheus'),
        '可观测性 · Prometheus');
    }
  }
  if (picks.deploy === 'jar') {
    push('deploy/systemd/app.service', systemdUnit(app, composed), '交付形态 · 进程守护');
  }
  if (picks.deploy === 'k8s') {
    const k = '交付形态 · Kubernetes';
    push('deploy/k8s/00-namespace.yaml', namespace(ctx), k);
    push('deploy/k8s/01-configmap.yaml', configMap(ctx), k);
    push('deploy/k8s/02-secret.yaml', secretDoc(ctx), k);
    push('deploy/k8s/03-serviceaccount.yaml', serviceAccount(ctx), k);
    push('deploy/k8s/04-deployment.yaml', deployment(ctx), k);
    push('deploy/k8s/05-service.yaml', service(ctx), k);
    push('deploy/k8s/06-ingress.yaml', ingress(ctx), k);
    push('deploy/k8s/07-hpa.yaml', hpa(ctx), k);
    push('deploy/k8s/08-pdb.yaml', pdb(ctx), k);
    push('deploy/k8s/kustomization.yaml', kustomization(ctx), k);
  }
  if (picks.deploy === 'helm') {
    const h = '交付形态 · Helm';
    push('deploy/chart/Chart.yaml', chartYaml(app), h);
    push('deploy/chart/values.yaml', values(app, port, ctx.plain, ctx.grace), h);
    push('deploy/chart/values-dev.yaml', valuesDev(app), h);
    push('deploy/chart/values-prod.yaml', valuesProd(), h);
    push('deploy/chart/templates/_helpers.tpl', helpersTpl(app), h);
    push('deploy/chart/templates/deployment.yaml', chartDeployment(port, ctx.probes).replace(/%APP%/g, app), h);
    push('deploy/chart/templates/service.yaml', chartService().replace(/%APP%/g, app), h);
    push('deploy/chart/templates/ingress.yaml', chartIngress().replace(/%APP%/g, app), h);
    push('deploy/chart/templates/configmap.yaml', chartConfigMap().replace(/%APP%/g, app), h);
    push('deploy/chart/templates/secret.yaml', chartSecret(ctx.secret).replace(/%APP%/g, app), h);
    push('deploy/chart/templates/serviceaccount.yaml', chartServiceAccount().replace(/%APP%/g, app), h);
    push('deploy/chart/templates/hpa.yaml', chartHpa().replace(/%APP%/g, app), h);
    push('deploy/chart/templates/pdb.yaml', chartPdb().replace(/%APP%/g, app), h);
  }

  return out;
}
