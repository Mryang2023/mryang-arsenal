/**
 * 技术组件图标库 —— 纯手绘 SVG，零依赖、零外链。
 *
 * 为什么不引图标库（simple-icons / devicon）：
 *   ① 那些是真实商标，画进交付物里要背授权说明；
 *   ② 一套图标库动辄几 MB，而这个仓库的规矩是「产物要能进 Git、能 diff」；
 *   ③ 真正要的只是「一眼认出这是 MySQL 还是 Redis」，不是商标复刻。
 * 所以这里做的是**品牌色 + 简化几何符号**：颜色负责唤起品牌，形状负责表达类别
 * （数据库=圆柱、队列=堆叠管道、注册中心=六角、缓存=闪电、文档=纸张、安全=盾）。
 * 换一行代码就能换掉整张图的观感，不牵动任何构建。
 *
 * 画布统一 24×24，图形一律用 currentColor，颜色由外层的 style="color:…" 决定 ——
 * 这样同一份图形在浅色/深色底上都能靠换色值保持对比度。
 */

export interface TechIcon {
  /** 图标展示名（调色板里显示） */
  name: string;
  /** 品牌色。已按深色底调过亮度，保证在深色画布上看得清 */
  color: string;
  /** 24×24 视图内的图形，用 currentColor 上色 */
  svg: string;
  /** 类别，调色板按此分组 */
  kind:
    | 'runtime'
    | 'db'
    | 'cache'
    | 'mq'
    | 'registry'
    | 'doc'
    | 'security'
    | 'observe'
    | 'infra'
    | 'tool'
    | 'none';
}

const P = (d: string, extra = '') => `<path d="${d}"${extra ? ' ' + extra : ''}/>`;
const C = (cx: number, cy: number, r: number, extra = '') =>
  `<circle cx="${cx}" cy="${cy}" r="${r}"${extra ? ' ' + extra : ''}/>`;
const R = (x: number, y: number, w: number, h: number, rx = 2, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"${extra ? ' ' + extra : ''}/>`;
/** 空心描边：图标里需要"线稿"的部分（默认 none + stroke-currentColor） */
const S = (d: string, w = 1.6) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const TECH_ICONS: Record<string, TechIcon> = {
  // ── 运行时 / 框架 ──────────────────────────────────────
  jdk: {
    name: 'Java / JDK',
    color: '#F89820',
    kind: 'runtime',
    svg:
      S('M7 9h9v6a3 3 0 0 1-3 3h-3a3 3 0 0 1-3-3V9Z') +
      S('M16 10.5h1.8a2 2 0 0 1 0 4H16') +
      S('M9.5 3.5c0 .9-.9 1.2-.9 2.2s.9 1.3.9 2.2') +
      S('M13 3.5c0 .9-.9 1.2-.9 2.2s.9 1.3.9 2.2', 1.4),
  },
  spring: {
    name: 'Spring Boot',
    color: '#6DB33F',
    kind: 'runtime',
    svg:
      C(12, 12, 9, 'fill="none" stroke="currentColor" stroke-width="1.8"') +
      P('M12 6.5c2.6-2.6 6-2.6 6-2.6s0 3.4-2.6 6c-1.9 1.9-4.7 2.4-7 1.4 2.6.7 5.2-.3 6.8-2.2',
        'opacity="0.95"') +
      C(12, 12, 2.2),
  },
  tomcat: {
    name: 'Tomcat',
    color: '#F0A93B',
    kind: 'runtime',
    svg:
      P('M4 8.5 5.6 4h2.2l2 4.5Z') +
      P('M14.2 8.5 15.8 4H18l2 4.5Z') +
      C(12, 13, 7) +
      C(9.6, 12, 1.2, 'fill="#1B1206"') +
      C(14.4, 12, 1.2, 'fill="#1B1206"') +
      S('M9.5 15.5c1.6 1.2 3.4 1.2 5 0', 1.4),
  },
  netty: {
    name: 'Netty',
    color: '#4FC3F7',
    kind: 'runtime',
    svg:
      S('M4 7h16') + S('M4 12h16') + S('M4 17h16') +
      C(8, 7, 2.2) + C(16, 12, 2.2) + C(10, 17, 2.2),
  },
  webflux: {
    name: 'WebFlux / Reactive',
    color: '#7C4DFF',
    kind: 'runtime',
    svg: S('M3 15c3-6 6 6 9 0s6-6 9 0', 1.9) + C(6, 15, 2.2) + C(18, 15, 2.2),
  },

  // ── 数据层 ────────────────────────────────────────────
  mysql: {
    name: 'MySQL',
    color: '#00A0C6',
    kind: 'db',
    svg:
      P('M12 3.2c4.4 0 8 1.2 8 2.7v12.2c0 1.5-3.6 2.7-8 2.7s-8-1.2-8-2.7V5.9c0-1.5 3.6-2.7 8-2.7Z',
        'opacity="0.28"') +
      S('M4 5.9c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7') +
      S('M4 5.9v12.2c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7V5.9') +
      S('M4 12c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7', 1.2),
  },
  postgres: {
    name: 'PostgreSQL',
    color: '#5AA9E6',
    kind: 'db',
    svg:
      S('M6 5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5') +
      S('M18 5v14c0 1.4-2.7 2.5-6 2.5S6 20.4 6 19V5') +
      S('M6 12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5', 1.2) +
      C(9.2, 7.6, 1.1) + C(14.8, 7.6, 1.1),
  },
  mongodb: {
    name: 'MongoDB',
    color: '#5CC98A',
    kind: 'db',
    svg:
      P('M12 2.5c2.9 3.9 4.2 7 4.2 9.8a4.2 4.2 0 0 1-8.4 0c0-2.8 1.3-5.9 4.2-9.8Z',
        'opacity="0.35"') +
      S('M12 2.5c2.9 3.9 4.2 7 4.2 9.8a4.2 4.2 0 0 1-8.4 0c0-2.8 1.3-5.9 4.2-9.8Z', 1.6) +
      S('M12 7.5v13.5', 1.6),
  },
  oracle: {
    name: 'Oracle',
    color: '#F4511E',
    kind: 'db',
    svg:
      P('M12 3.2c4.4 0 8 1.2 8 2.7v12.2c0 1.5-3.6 2.7-8 2.7s-8-1.2-8-2.7V5.9c0-1.5 3.6-2.7 8-2.7Z',
        'opacity="0.25"') +
      S('M4 5.9c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7') +
      S('M4 5.9v12.2c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7V5.9') +
      C(12, 12, 3.2, 'fill="none" stroke="currentColor" stroke-width="1.6"'),
  },
  clickhouse: {
    name: 'ClickHouse',
    color: '#F5C518',
    kind: 'db',
    svg: R(3, 15, 4, 6, 1) + R(8.5, 10, 4, 11, 1) + R(14, 4, 4, 17, 1) + R(19.2, 12, 2.2, 9, 1, 'opacity="0.6"'),
  },

  // ── 持久层 / 迁移 ──────────────────────────────────────
  jdbc: {
    name: 'JdbcTemplate',
    color: '#4A9AD4',
    kind: 'db',
    svg:
      S('M4 6h16v5H4z') + S('M4 13h16v5H4z') + S('M8 6V3.5') + S('M16 6V3.5') +
      C(8, 8.5, 1) + C(16, 8.5, 1) + C(8, 15.5, 1) + C(16, 15.5, 1),
  },
  mybatis: {
    name: 'MyBatis-Plus',
    color: '#4E9FD1',
    kind: 'db',
    svg:
      S('M5 4.5h9l5 5v10a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19.5V6a1.5 1.5 0 0 1 1-1.5Z') +
      S('M14 4.5V10h5') + S('M7.5 14h9') + S('M7.5 17.5h5.5', 1.2),
  },
  jpa: {
    name: 'Spring Data JPA',
    color: '#8FA3B0',
    kind: 'db',
    svg:
      C(7, 8, 3.2, 'fill="none" stroke="currentColor" stroke-width="1.6"') +
      C(17, 8, 3.2, 'fill="none" stroke="currentColor" stroke-width="1.6"') +
      C(12, 17.5, 3.2, 'fill="none" stroke="currentColor" stroke-width="1.6"') +
      S('M9.5 9.5 14.5 9.5') + S('M15 9.5 11 15.5') + S('M9 9.5 13.5 15.5'),
  },
  flyway: {
    name: 'Flyway',
    color: '#E85A4F',
    kind: 'db',
    svg:
      P('M14.5 4.5 8 11l-2.5 2.5L8 16l6.5-6.5Z', 'opacity="0.5"') +
      P('M17 3.2 20.8 7 17 10.8 13.2 7Z') +
      S('M4 20.5 9 15.5', 1.8),
  },
  liquibase: {
    name: 'Liquibase',
    color: '#3E8EDE',
    kind: 'db',
    svg:
      P('M12 3.5c3.4 4 5.2 6.9 5.2 9.4A5.2 5.2 0 0 1 6.8 12.9c0-2.5 1.8-5.4 5.2-9.4Z',
        'opacity="0.4"') +
      S('M12 3.5c3.4 4 5.2 6.9 5.2 9.4A5.2 5.2 0 0 1 6.8 12.9c0-2.5 1.8-5.4 5.2-9.4Z', 1.6) +
      C(12, 13.5, 1.6),
  },
  hikari: {
    name: 'HikariCP',
    color: '#5AD1F5',
    kind: 'db',
    svg:
      C(12, 12, 4) +
      P('M12 2.5 13.6 8 19 9.5 13.6 11 12 16.5 10.4 11 5 9.5 10.4 8Z', 'opacity="0.75"') +
      S('M12 19.5v2', 1.6),
  },
  druid: {
    name: 'Druid',
    color: '#7CB342',
    kind: 'db',
    svg:
      P('M12 3.5c3.4 4 5.2 6.9 5.2 9.4A5.2 5.2 0 0 1 6.8 12.9c0-2.5 1.8-5.4 5.2-9.4Z') +
      S('M12 8v13', 1.5),
  },

  // ── 缓存 ──────────────────────────────────────────────
  redis: {
    name: 'Redis',
    color: '#E04B3A',
    kind: 'cache',
    svg:
      P('M12 3 3 7.2l9 4.2 9-4.2Z') +
      P('M3 12l9 4.2 9-4.2', 'opacity="0.75"') +
      P('M3 16.8 12 21l9-4.2', 'opacity="0.5"'),
  },
  caffeine: {
    name: 'Caffeine',
    color: '#C08552',
    kind: 'cache',
    svg:
      S('M5 8h10v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8Z') +
      S('M15 9.5h2a2.2 2.2 0 0 1 0 4.4h-2') +
      S('M8.5 3c0 1-1 1.3-1 2.4s1 1.4 1 2.4') +
      S('M12.5 3c0 1-1 1.3-1 2.4s1 1.4 1 2.4', 1.3),
  },
  memcached: {
    name: 'Memcached',
    color: '#9AA5B1',
    kind: 'cache',
    svg: R(3, 6, 18, 12, 2, 'fill="none" stroke="currentColor" stroke-width="1.6"') +
      S('M7 9.5v5') + S('M11 9.5v5') + S('M15 9.5v5') + S('M19 9.5v5'),
  },

  // ── 消息队列 ──────────────────────────────────────────
  kafka: {
    name: 'Kafka',
    color: '#B0BEC5',
    kind: 'mq',
    svg: C(6, 6.5, 3) + C(18, 6.5, 3) + C(12, 17.5, 3) + S('M8.6 8.4 10.4 15.5', 1.5) + S('M15.4 8.4 13.6 15.5', 1.5) + S('M9 6.5h6', 1.5),
  },
  rocketmq: {
    name: 'RocketMQ',
    color: '#E6523B',
    kind: 'mq',
    svg: P('M12 2.5c2.6 3 4 5.4 4 7.6L12 14l-4-3.9c0-2.2 1.4-4.6 4-7.6Z') + S('M8.5 14.5 6 21l6-3 6 3-2.5-6.5', 1.5),
  },
  rabbitmq: {
    name: 'RabbitMQ',
    color: '#FF7A33',
    kind: 'mq',
    svg: R(5, 9.5, 14, 10, 2.5) + P('M7.5 9.5 6.8 3h2.6l1.4 6.5Z') + P('M16.5 9.5 15.8 3h2.6l1.4 6.5Z') + C(9.4, 14.5, 1.2, 'fill="#2A1508"') + C(14.6, 14.5, 1.2, 'fill="#2A1508"'),
  },
  pulsar: {
    name: 'Pulsar',
    color: '#F5A623',
    kind: 'mq',
    svg: C(12, 12, 3) + S('M12 4v3') + S('M12 17v3') + S('M4 12h3') + S('M17 12h3') + S('M6.3 6.3 8.4 8.4') + S('M15.6 15.6 17.7 17.7') + S('M17.7 6.3 15.6 8.4') + S('M8.4 15.6 6.3 17.7', 1.4),
  },

  // ── 注册中心 / 治理 ────────────────────────────────────
  nacos: {
    name: 'Nacos',
    color: '#4A8FE7',
    kind: 'registry',
    svg:
      S('M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z', 1.7) +
      P('M8.6 16V8l6.8 8V8', 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'),
  },
  consul: {
    name: 'Consul',
    color: '#E0578A',
    kind: 'registry',
    svg: S('M12 3 20 7.5v9L12 21l-8-4.5v-9Z', 1.7) + C(12, 12, 3.4, 'fill="none" stroke="currentColor" stroke-width="1.7"'),
  },
  zookeeper: {
    name: 'ZooKeeper',
    color: '#C8A26A',
    kind: 'registry',
    svg: C(12, 6.5, 3) + C(6.5, 16, 3) + C(17.5, 16, 3) + S('M9.5 8.5 7.5 13.5', 1.5) + S('M14.5 8.5 16.5 13.5', 1.5) + S('M9 16h6', 1.5),
  },
  sentinel: {
    name: 'Sentinel',
    color: '#F37335',
    kind: 'registry',
    svg: P('M12 3 4 6v6c0 4.6 3.4 7.8 8 9 4.6-1.2 8-4.4 8-9V6Z', 'opacity="0.35"') + S('M12 3 4 6v6c0 4.6 3.4 7.8 8 9 4.6-1.2 8-4.4 8-9V6Z', 1.7) + S('M7.5 12h2.2l1.2-2.4 1.6 4.8 1.2-2.4h2.8', 1.5),
  },

  // ── 文档 / 契约 ───────────────────────────────────────
  springdoc: {
    name: 'SpringDoc OpenAPI',
    color: '#8FD14F',
    kind: 'doc',
    svg: S('M5.5 4h9l4.5 4.5V20a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z') + S('M14 4v5h5') + S('M8.5 12.5h7') + S('M8.5 15.5h7') + S('M8.5 18.5h4', 1.2),
  },
  knife4j: {
    name: 'Knife4j',
    color: '#7ED321',
    kind: 'doc',
    svg: S('M5.5 4h9l4.5 4.5V20a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z') + S('M14 4v5h5') + S('M8 19 16 11', 1.8) + S('M15 19h3v-3', 1.6),
  },
  logback: {
    name: '日志',
    color: '#9AA5B1',
    kind: 'observe',
    svg: S('M5.5 4h9l4.5 4.5V20a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z') + S('M14 4v5h5') + C(12, 14.5, 3.4, 'fill="none" stroke="currentColor" stroke-width="1.6"') + S('M15.5 17.5 18 20', 1.6),
  },

  // ── 安全 ──────────────────────────────────────────────
  security: {
    name: 'Spring Security',
    color: '#5FBF5F',
    kind: 'security',
    svg: P('M12 3 4.5 6v6c0 4.6 3.4 7.8 7.5 9 4.1-1.2 7.5-4.4 7.5-9V6Z') + S('M8.5 12.2l2.4 2.4 4.6-4.6', 1.9),
  },
  satoken: {
    name: 'Sa-Token',
    color: '#4FC08D',
    kind: 'security',
    svg: P('M12 3 4.5 6v6c0 4.6 3.4 7.8 7.5 9 4.1-1.2 7.5-4.4 7.5-9V6Z', 'opacity="0.4"') + S('M12 3 4.5 6v6c0 4.6 3.4 7.8 7.5 9 4.1-1.2 7.5-4.4 7.5-9V6Z', 1.7) + S('M12 8v8', 1.6) + S('M8.8 10.4h6.4', 1.6),
  },
  jwt: {
    name: 'JWT',
    color: '#D63AFF',
    kind: 'security',
    svg: S('M12 3 4.5 6v6c0 4.6 3.4 7.8 7.5 9 4.1-1.2 7.5-4.4 7.5-9V6Z', 1.7) + C(12, 12, 2.6) + S('M8.4 12h7.2', 1.4) + S('M10.4 9.6v4.8', 1.4) + S('M13.6 9.6v4.8', 1.4),
  },

  // ── 可观测性 ──────────────────────────────────────────
  actuator: {
    name: 'Actuator',
    color: '#6DB33F',
    kind: 'observe',
    svg: C(12, 13, 8, 'fill="none" stroke="currentColor" stroke-width="1.8"') + S('M12 13 16.5 8.5', 1.8) + R(11, 2.2, 2, 2.6, 1) + S('M6 18.5h12', 1.4),
  },
  prometheus: {
    name: 'Prometheus',
    color: '#F0733A',
    kind: 'observe',
    svg: P('M12 2.5c1.9 3.2 1.2 5-.4 6.7-1.7 1.8-3.2 3-1.6 5.3 1.6 2.3 5.2 2.6 8 .9.8-.5 1.4-1.1 1.9-1.8-.7 3.4-3.1 5.9-6.9 6.4-4.6.6-8.6-2.6-9.2-7.2-.6-4.9 2.4-8.6 8.2-10.3Z') + P('M13.6 9.2c.9-1.9 2.3-3.2 4-4-.5 2.4-1.9 3.9-4 4.8Z', 'opacity="0.7"'),
  },
  grafana: {
    name: 'Grafana',
    color: '#F46800',
    kind: 'observe',
    svg: C(12, 12, 9, 'fill="none" stroke="currentColor" stroke-width="1.8"') + P('M12 5.5a6.5 6.5 0 0 1 6.5 6.5H12Z') + C(12, 12, 2.4) + S('M4.5 17.5c1.4-3 3.2-4.6 5.4-4.8', 1.6),
  },
  elasticsearch: {
    name: 'Elasticsearch',
    color: '#00BFB3',
    kind: 'observe',
    svg: S('M4 7.5c3.5-2.6 7-2.6 10.5 0L20 7.5v9c-3.5 2.6-7 2.6-10.5 0L4 16.5Z', 1.7) + S('M9.5 7.5v9') + S('M14.5 7.5v9', 1.4),
  },

  // ── 基础设施 ──────────────────────────────────────────
  nginx: {
    name: 'Nginx',
    color: '#3FA34D',
    kind: 'infra',
    svg: C(12, 12, 9, 'fill="none" stroke="currentColor" stroke-width="1.8"') + P('M8 16V8l8 8V8', 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'),
  },
  gateway: {
    name: 'API 网关',
    color: '#7C6BF5',
    kind: 'infra',
    svg: R(3, 4.5, 7, 6, 1.5, 'fill="none" stroke="currentColor" stroke-width="1.6"') + R(14, 4.5, 7, 6, 1.5, 'fill="none" stroke="currentColor" stroke-width="1.6"') + R(8.5, 14, 7, 6, 1.5, 'fill="none" stroke="currentColor" stroke-width="1.6"') + S('M6.5 10.5v2h4v1.5') + S('M17.5 10.5v2h-4v1.5', 1.5),
  },
  docker: {
    name: 'Docker',
    color: '#3D9BED',
    kind: 'infra',
    svg: R(3, 11, 3.6, 3.6, 0.6) + R(7.2, 11, 3.6, 3.6, 0.6) + R(11.4, 11, 3.6, 3.6, 0.6) + R(7.2, 6.8, 3.6, 3.6, 0.6) + R(11.4, 6.8, 3.6, 3.6, 0.6) + S('M2 14.6c0 3 2.3 5.4 5.6 5.4h9.2c3.6 0 5.6-2.4 5.6-5.4', 1.6),
  },
  k8s: {
    name: 'Kubernetes',
    color: '#4A8FE7',
    kind: 'infra',
    svg: S('M12 2.5 20.2 7v10L12 21.5 3.8 17V7Z', 1.7) + C(12, 12, 3.4, 'fill="none" stroke="currentColor" stroke-width="1.6"') + S('M12 8.6 15.2 10.4v3.2L12 15.4l-3.2-1.8v-3.2Z', 1.5),
  },
  helm: {
    name: 'Helm',
    color: '#0F9CD6',
    kind: 'infra',
    // 舵轮：外圈 + 八根辐条 + 中心轮毂。用圆的八等分点算出辐条端点，
    // 手写坐标会越写越歪，而它是对称图形 —— 差一点就能被眼睛看出来。
    svg: (() => {
      const spokes = Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI / 4) * i;
        const x = 12 + Math.cos(a) * 8.4;
        const y = 12 + Math.sin(a) * 8.4;
        return S(`M12 12 ${x.toFixed(1)} ${y.toFixed(1)}`, 1.5);
      }).join('');
      return (
        C(12, 12, 9.2, 'fill="none" stroke="currentColor" stroke-width="1.7"') +
        spokes +
        C(12, 12, 2.4)
      );
    })(),
  },
  jar: {
    name: '可执行 JAR',
    color: '#B98A3C',
    kind: 'tool',
    // 一个罐子：罐体 + 卷边口 + 标签纸 —— 强调它是「已打包的产物」而不是源码目录。
    svg:
      S('M6.5 4.5h11a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18V6a1.5 1.5 0 0 1 1.5-1.5Z', 1.7) +
      S('M8 4.5V3h8v1.5', 1.6) +
      R(8, 9.5, 8, 5, 1, 'fill="currentColor" opacity="0.85"') +
      S('M9.5 12h5', 1.2),
  },
  minio: {
    name: 'MinIO / 对象存储',
    color: '#D94862',
    kind: 'infra',
    svg: S('M5 7h14l-1.4 12a1.5 1.5 0 0 1-1.5 1.3H7.9a1.5 1.5 0 0 1-1.5-1.3Z', 1.7) + S('M3.5 7h17', 1.7) + S('M9 11v6', 1.4) + S('M15 11v6', 1.4),
  },
  slb: {
    name: '负载均衡',
    color: '#5C9DED',
    kind: 'infra',
    svg: C(12, 5, 3) + C(5, 19, 3) + C(19, 19, 3) + S('M12 8v4') + S('M12 12 7 16.5') + S('M12 12l5 4.5', 1.6),
  },

  // ── 工具 / 工程 ───────────────────────────────────────
  maven: {
    name: 'Maven',
    color: '#D64550',
    kind: 'tool',
    svg: P('M12 3 21 8.2 12 13.4 3 8.2Z', 'opacity="0.6"') + S('M12 3 21 8.2 12 13.4 3 8.2Z', 1.6) + S('M3 12.6 12 17.8l9-5.2', 1.4) + S('M3 16.8 12 22l9-5.2', 1.2),
  },
  gradle: {
    name: 'Gradle',
    color: '#4CA1AF',
    kind: 'tool',
    svg: C(12, 12, 9, 'fill="none" stroke="currentColor" stroke-width="1.8"') + C(7.5, 15, 3.2) + C(16.5, 9, 3.2) + S('M4.5 15.5 10 10', 1.6),
  },
  mapstruct: {
    name: 'MapStruct',
    color: '#C08B5C',
    kind: 'tool',
    svg: R(3, 5, 7, 6, 1.2, 'fill="none" stroke="currentColor" stroke-width="1.6"') + R(14, 13, 7, 6, 1.2, 'fill="none" stroke="currentColor" stroke-width="1.6"') + S('M10 11 14 13', 1.6) + S('M6.5 8h0.01', 2) + S('M17.5 16h0.01', 2),
  },
  lombok: {
    name: 'Lombok',
    color: '#C98B4B',
    kind: 'tool',
    svg: S('M6 4h12v13l-6 3-6-3Z', 1.6) + C(12, 11, 4.2, 'fill="none" stroke="currentColor" stroke-width="1.6"') + S('M12 6.8v8.4', 1.4) + S('M8.5 11h7', 1.4),
  },
  junit: {
    name: 'JUnit 5',
    color: '#5FA85F',
    kind: 'tool',
    svg: C(12, 12, 9, 'fill="none" stroke="currentColor" stroke-width="1.7"') + S('M8.6 12.2l2.2 2.2 4.6-4.8', 1.9),
  },
  testcontainers: {
    name: 'Testcontainers',
    color: '#3D9BED',
    kind: 'tool',
    svg: R(4, 6, 5, 4.4, 0.8) + R(10.5, 6, 5, 4.4, 0.8) + R(4, 12.4, 5, 4.4, 0.8) + R(10.5, 12.4, 5, 4.4, 0.8) + S('M2 18.4h20', 1.5),
  },
  scheduler: {
    name: '定时任务',
    color: '#4A8FE7',
    kind: 'tool',
    svg: C(12, 12, 9, 'fill="none" stroke="currentColor" stroke-width="1.7"') + S('M12 7v5.2l3.4 2', 1.7),
  },
  xxljob: {
    name: 'XXL-Job',
    color: '#3C8CE7',
    kind: 'tool',
    svg: C(12, 12, 9, 'fill="none" stroke="currentColor" stroke-width="1.7"') + S('M12 7v5.2l3.4 2', 1.7) + S('M3.5 19.5h17', 1.4) + S('M6 19.5 8 16', 1.4) + S('M18 19.5 16 16', 1.4),
  },

  // ── CI / CD / 编排 ────────────────────────────────────
  jenkins: {
    name: 'Jenkins',
    color: '#D33833',
    kind: 'tool',
    svg:
      S('M6.5 15.5 4 18l2.5 2.5M17.5 15.5 20 18l-2.5 2.5', 1.5) +
      S('M9.5 4.5h5l-1 3h-3Z') +
      S('M12 7.5V12M8.5 8.5 12 12M15.5 8.5 12 12', 1.4) +
      C(12, 19.5, 1.6),
  },
  gitlab: {
    name: 'GitLab',
    color: '#FC6D26',
    kind: 'tool',
    svg: S('M12 20.5 6.6 4l10.8 8.2Z') + S('M12 20.5 17.4 4 6.6 12.2Z', 1.3) + S('M6.6 4h10.8', 1.3),
  },
  argocd: {
    name: 'Argo CD',
    color: '#EF7B4D',
    kind: 'tool',
    svg: C(12, 12, 8.5, 'fill="none" stroke="currentColor" stroke-width="1.5"') + S('M12 8.5v7M8.5 12h7', 1.5) + S('M15.5 9 18 6.5M15.5 15 18 17.5', 1.3),
  },
  terraform: {
    name: 'Terraform',
    color: '#844FBA',
    kind: 'infra',
    svg: S('M9 4.5v9M14.5 4.5v6M4.5 4.5v6') + R(9, 13.5, 5.5, 5.5, 1) + R(14.5, 10.5, 5.5, 5.5, 1) + R(4.5, 10.5, 4, 4, 1),
  },
  harbor: {
    name: 'Harbor',
    color: '#60A5FA',
    kind: 'infra',
    svg: S('M3.5 15.5h17l-2 4h-13Z', 1.4) + S('M6 15.5V9h12v6.5', 1.3) + S('M12 6.5V3.5M9 5.5 12 3.5l3 2', 1.3),
  },
  nexus: {
    name: 'Nexus',
    color: '#3B82C4',
    kind: 'tool',
    svg: C(12, 12, 8, 'fill="none" stroke="currentColor" stroke-width="1.6"') + S('M7 9.5h10M7 14.5h10', 1.3) + S('M12 4v16', 1.3),
  },

  // ── 可观测性（续） ──────────────────────────────────────
  jaeger: {
    name: 'Jaeger',
    color: '#66DFE6',
    kind: 'observe',
    svg:
      S('M4 6.5h6M4 12h9M4 17.5h5', 1.5) +
      C(13, 6.5, 2.1) + C(16.5, 12, 2.1) + C(12, 17.5, 2.1) +
      S('M15.5 8.5 18 11M18 13.5 15 16', 1.2),
  },
  skywalking: {
    name: 'SkyWalking',
    color: '#3D8BFD',
    kind: 'observe',
    svg: S('M3.5 14.5 8 9l4 4 3.5-4 5 5.5', 1.7) + C(8, 9, 1.5) + S('M3.5 19.5h17', 1.2),
  },
  loki: {
    name: 'Loki',
    color: '#F5A623',
    kind: 'observe',
    svg: S('M5 4.5h11l3.5 3.5v11.5H5Z') + S('M16 4.5v3.5h3.5') + S('M8 10h8M8 13h8M8 16h5', 1.2),
  },
  tempo: {
    name: 'Tempo',
    color: '#F4682B',
    kind: 'observe',
    svg: S('M4 12a8 8 0 0 1 8-8M20 12a8 8 0 0 1-8 8', 1.6) + S('M12 4v16', 1.2) + C(12, 12, 2.2),
  },
  alertmanager: {
    name: 'Alertmanager',
    color: '#CE412B',
    kind: 'observe',
    svg: S('M6 16.5V11a6 6 0 0 1 12 0v5.5l-2 2.5H8Z', 1.5) + S('M9.5 19.5a2.5 2.5 0 0 0 5 0', 1.4) + S('M4.5 11h15', 1.2),
  },
  opentelemetry: {
    name: 'OpenTelemetry',
    color: '#5B8BF5',
    kind: 'observe',
    svg: C(12, 12, 3.2) + C(12, 12, 7.5, 'fill="none" stroke="currentColor" stroke-width="1.3"') + S('M12 4.5v2.5M12 17v2.5M4.5 12H7M17 12h2.5', 1.4),
  },
  sonarqube: {
    name: 'SonarQube',
    color: '#4E9BCD',
    kind: 'tool',
    svg: S('M12 4.5 20 19.5H4Z', 1.6) + S('M9 15.5h6', 1.4) + S('M10.5 12h3', 1.3),
  },

  // ── 服务网格 / 网关（续） ────────────────────────────────
  istio: {
    name: 'Istio',
    color: '#466BB0',
    kind: 'infra',
    svg: S('M12 3.5 20 7v10l-8 3.5L4 17V7Z', 1.5) + S('M6.5 9.5h11M6.5 14.5h11', 1.2) + C(12, 12, 2.2),
  },
  envoy: {
    name: 'Envoy',
    color: '#C0392B',
    kind: 'infra',
    svg: S('M4 12h16', 1.5) + S('M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5', 1.4),
  },
  apisix: {
    name: 'APISIX',
    color: '#E86821',
    kind: 'infra',
    svg: S('M4.5 12h15M6.5 8.5h11M6.5 15.5h11', 1.4) + C(12, 12, 2.6) + S('M12 4.5v2.5M12 17v2.5', 1.2),
  },
  keycloak: {
    name: 'Keycloak',
    color: '#4D4D4D',
    kind: 'security',
    svg: S('M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 1.4) + S('M12 8v8M8.5 10.5l7 3M15.5 10.5l-7 3', 1.4),
  },
  apollo: {
    name: 'Apollo 配置中心',
    color: '#2C7BE5',
    kind: 'registry',
    svg: C(12, 12, 8.5, 'fill="none" stroke="currentColor" stroke-width="1.5"') + S('M12 6.5v11M6.5 12h11', 1.3) + C(12, 12, 3),
  },
  etcd: {
    name: 'etcd',
    color: '#419EDA',
    kind: 'registry',
    svg: C(12, 12, 8, 'fill="none" stroke="currentColor" stroke-width="1.5"') + S('M12 4v4M12 16v4M4 12h4M16 12h4', 1.4) + C(12, 12, 2.4),
  },

  // ── 存储（续） ─────────────────────────────────────────
  sqlite: {
    name: 'SQLite',
    color: '#0F80CC',
    kind: 'db',
    svg: S('M5.5 4.5c-1.5 2.5-2 6-1.5 9.5s2 5.5 3.5 5.5', 1.5) + S('M18.5 4.5c-1 2-1.5 4.5-1.5 7s.5 5 1.5 7', 1.5) + S('M12 4.5c0 5 0 10 0 15', 1.2),
  },
  hbase: {
    name: 'HBase',
    color: '#E8A33D',
    kind: 'db',
    svg: S('M4 6c0-1.2 3.6-2.2 8-2.2s8 1 8 2.2v12c0 1.2-3.6 2.2-8 2.2s-8-1-8-2.2Z', 1.5) + S('M4 6v3.5c0 1.2 3.6 2.2 8 2.2s8-1 8-2.2V6', 1.2) + S('M8.5 13.5h7', 1.2),
  },
  tidb: {
    name: 'TiDB',
    color: '#DC1B2E',
    kind: 'db',
    svg: S('M12 4.5 20 8v8l-8 3.5L4 16V8Z', 1.5) + S('M4 8l8 3.5 8-3.5M12 11.5V20', 1.2),
  },
  influxdb: {
    name: 'InfluxDB',
    color: '#22ADF6',
    kind: 'db',
    svg: C(12, 12, 8.5, 'fill="none" stroke="currentColor" stroke-width="1.5"') + S('M5.5 15.5 9 11l3 3 6.5-7', 1.7),
  },
  opensearch: {
    name: 'OpenSearch',
    color: '#005EB8',
    kind: 'observe',
    svg: C(10.5, 10.5, 6.5, 'fill="none" stroke="currentColor" stroke-width="1.6"') + S('M15.5 15.5 20 20', 2) + S('M7.5 10.5h6', 1.2),
  },

  // ── 运行时 / 前端工具链 ──────────────────────────────────
  quarkus: {
    name: 'Quarkus',
    color: '#4695EB',
    kind: 'runtime',
    svg: S('M12 4.5 6 8v8l6 3.5 6-3.5V8Z', 1.5) + S('M9.5 15.5 12 9l2.5 6.5Z') + S('M10.5 13.5h3', 1.2),
  },
  undertow: {
    name: 'Undertow',
    color: '#B0BEC5',
    kind: 'runtime',
    svg: S('M4 8.5h16M4 15.5h16', 1.6) + S('M8 8.5v7M16 8.5v7', 1.4) + S('M12 11.5v1', 2),
  },
  vertx: {
    name: 'Vert.x',
    color: '#B32019',
    kind: 'runtime',
    svg: S('M12 4.5 19 16.5H5Z', 1.6) + S('M12 9.5v4', 1.6) + S('M9.5 14h5', 1.3),
  },
  nodejs: {
    name: 'Node.js',
    color: '#5FA04E',
    kind: 'runtime',
    svg: S('M12 3.5 20 7.5v9L12 20.5 4 16.5v-9Z', 1.5) + S('M9 10.5v3M15 10.5v3', 1.4),
  },
  vite: {
    name: 'Vite',
    color: '#A855F7',
    kind: 'tool',
    svg: S('M12 3.5 4.5 19.5 12 17l7.5 2.5Z', 1.5) + S('M12 8.5l3 6-3-1.5-3 1.5Z'),
  },
  nextjs: {
    name: 'Next.js',
    color: '#E5E7EB',
    kind: 'tool',
    svg: C(12, 12, 8.5, 'fill="none" stroke="currentColor" stroke-width="1.5"') + S('M9 15.5V9l6 7.5', 1.6) + S('M15.5 9v5', 1.3),
  },
  python: {
    name: 'Python',
    color: '#FFD43B',
    kind: 'tool',
    svg: S('M12 4.5c-3.5 0-4 2-4 3.5h8c0-1.5-.5-3.5-4-3.5Z', 1.4) + S('M8 8.5v7c0 2 .5 4 4 4s4-2 4-4v-7Z', 1.4) + S('M16 8.5c0-1.5-.5-3.5-4-3.5S8 7 8 8.5', 1.2) + C(9.6, 7, 0.7) + C(14.4, 17, 0.7),
  },
  git: {
    name: 'Git',
    color: '#F05033',
    kind: 'tool',
    svg: S('M5 12h14', 1.5) + C(5, 12, 2.4, 'fill="none" stroke="currentColor" stroke-width="1.6"') + C(19, 12, 2.4, 'fill="none" stroke="currentColor" stroke-width="1.6"') + S('M9 6.5 5 12l4 5.5', 1.4),
  },

  // ── 占位 / 留空 ───────────────────────────────────────
  client: {
    name: '客户端',
    color: '#7FB3D5',
    kind: 'infra',
    svg:
      R(3, 4.5, 18, 12, 2, 'fill="none" stroke="currentColor" stroke-width="1.7"') +
      S('M9.5 20.5h5', 1.7) +
      S('M12 16.5v4', 1.7) +
      P('M8.6 13c.5-2 1.8-3 3.4-3s2.9 1 3.4 3Z', 'opacity="0.8"') +
      C(12, 7.6, 1.7),
  },
  none: {
    name: '留空 / 不启用',
    color: '#6B7280',
    kind: 'none',
    svg: S('M6 6l12 12') + S('M18 6 6 18', 1.8),
  },
  generic: {
    name: '通用组件',
    color: '#94A3B8',
    kind: 'none',
    svg: R(4, 4, 16, 16, 3, 'fill="none" stroke="currentColor" stroke-width="1.7"') + C(12, 12, 3.4),
  },
};

/** 图标 key → 展示名。取不到就用通用件，绝不崩。 */
export function iconName(key: string | undefined): string {
  return (key && TECH_ICONS[key]?.name) || '通用组件';
}

export function iconColor(key: string | undefined): string {
  return (key && TECH_ICONS[key]?.color) || TECH_ICONS.generic.color;
}

/** 把图标摆到 (x, y) 处，尺寸 size×size。 */
export function iconSvg(key: string | undefined, x: number, y: number, size: number): string {
  const icon = (key && TECH_ICONS[key]) || TECH_ICONS.generic;
  const s = size / 24;
  return (
    `<g transform="translate(${round(x)} ${round(y)}) scale(${round(s, 4)})" ` +
    `style="color:${icon.color}">${icon.svg}</g>`
  );
}

function round(n: number, p = 2): number {
  const m = 10 ** p;
  return Math.round(n * m) / m;
}
