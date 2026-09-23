/**
 * 部署指引数据。
 *
 * 这是「选中组件 → 怎么把它在服务器上装起来、配起来、代码里接起来」的现场手册。
 * 只覆盖「服务器侧」与「集群形态」—— 代码侧（yaml / 配置类）直接从选型台的
 * `arsenal-stacks/stack.json` 取，不在这里重复，免得两份慢慢漂移。
 *
 * 按 option id 挂：redis / mysql / postgres / rabbitmq / kafka 已种好；
 * 其它组件缺了就只在「部署指引」页签里显示为「暂无服务器部署指引」，不影响其它功能。
 * 扩成分两步：在下面这个表里补一条；集群形态补到对应条目的 `cluster` 里。
 *
 * 注：当前是前端自包含数据模块（先跑通）。按本仓库「事实源全 Git 化」的约定，
 * 后续应升级成 `arsenal-deploy/guides.json` 经 `sync` 生成 `@/generated/`，再做 4 处接线。
 */

export type DeployOs = 'linux' | 'docker' | 'mac';

export interface DeployStep {
  /** 这一步在说什么，比如「启动并设置开机自启」 */
  title?: string;
  /** 代码块语言，决定高亮 */
  lang: string;
  /** 命令或配置原文 */
  code: string;
  /** 这一步的提醒：坑、前提、为什么 */
  note?: string;
}

/** 单组件在某一形态下的服务器侧部署说明 */
export interface ServerGuide {
  name: string;
  /** 一句话定位：这东西在架构里干嘛 */
  intro: string;
  /** 单实例安装，按操作系统分 */
  install: Partial<Record<DeployOs, DeployStep[]>>;
  /** 集群 / 主从等形态的额外部署（仅当选了该形态才显示） */
  cluster?: {
    /** 哪种 topology mode 触发，比如 redis 的 'cluster' / mysql 的 'mgr' */
    modes: string[];
    title: string;
    intro: string;
    install: Partial<Record<DeployOs, DeployStep[]>>;
    notes: string[];
  };
}

export const OS_LABEL: Record<DeployOs, string> = {
  linux: 'Linux',
  docker: 'Docker',
  mac: 'macOS',
};

export const DEPLOY_GUIDES: Record<string, ServerGuide> = {
  redis: {
    name: 'Redis',
    intro: '分布式缓存 / 共享会话 / 分布式锁 / 简单消息队列。多实例共享一份数据。',
    install: {
      linux: [
        {
          title: 'Debian / Ubuntu 安装并开机自启',
          lang: 'bash',
          code: 'sudo apt update\nsudo apt install -y redis-server\nsudo systemctl enable --now redis-server',
        },
        {
          title: 'RHEL / CentOS（需 EPEL）',
          lang: 'bash',
          code: 'sudo dnf install -y epel-release\nsudo dnf install -y redis\nsudo systemctl enable --now redis',
        },
        {
          title: '改监听与保护模式（生产必须）',
          lang: 'bash',
          code: '# /etc/redis/redis.conf\nsudo sed -i "s/^bind 127.0.0.1 -::1/bind 0.0.0.0/" /etc/redis/redis.conf\nsudo sed -i "s/^# requirepass .*/requirepass <你的强密码>/" /etc/redis/redis.conf\nsudo systemctl restart redis-server',
          note: 'bind 0.0.0.0 后务必设 requirepass，否则等于把 Redis 裸奔到公网。',
        },
      ],
      docker: [
        {
          title: '单实例 + AOF 持久化',
          lang: 'bash',
          code: 'docker run -d --name redis \\\n  -p 6379:6379 \\\n  -v redis-data:/data \\\n  redis:7 --appendonly yes --requirepass <你的强密码>',
        },
      ],
      mac: [
        {
          title: 'Homebrew 安装并后台启动',
          lang: 'bash',
          code: 'brew install redis\nbrew services start redis',
        },
      ],
    },
    cluster: {
      modes: ['cluster'],
      title: 'Redis Cluster（数据分片集群）',
      intro:
        '生产最低 3 主做分片；每主配 1 从构成 3 主 3 从。客户端（Lettuce）自动发现拓扑，不用手动列全节点。',
      install: {
        linux: [
          {
            title: '每台机器准备 6 份配置（3 主 3 从，端口 7000–7005）',
            lang: 'bash',
            code:
              'for port in 7000 7001 7002 7003 7004 7005; do\n  mkdir -p /etc/redis/$port\n  cat > /etc/redis/$port/redis.conf <<EOF\nport $port\ncluster-enabled yes\ncluster-config-file nodes-$port.conf\ncluster-node-timeout 5000\nappendonly yes\nrequirepass <你的强密码>\nEOF\ndone',
          },
          {
            title: '逐份启动',
            lang: 'bash',
            code: 'for port in 7000 7001 7002 7003 7004 7005; do\n  redis-server /etc/redis/$port/redis.conf --daemonize yes\ndone',
          },
          {
            title: '用官方工具拉起集群（--cluster-replicas 1 = 每主 1 从）',
            lang: 'bash',
            code:
              'redis-cli --cluster create \\\n  <h1>:7000 <h1>:7001 <h1>:7002 \\\n  <h2>:7003 <h2>:7004 <h2>:7005 \\\n  --cluster-replicas 1 -a <你的强密码>',
            note: 'create 之后用 `redis-cli -c -p 7000 cluster info` 看集群状态；`-c` 是集群模式客户端。',
          },
        ],
        docker: [
          {
            title: '一键起 6 节点（含 3 主 3 从）',
            lang: 'bash',
            code:
              'docker run -d --name redis-cluster -p 7000-7005:7000-7005 \\\n  grokzen/redis-cluster:7.0\n# 该镜像内置 6 节点且自动 meet，开箱即集群',
          },
        ],
      },
      notes: [
        '代码侧把 `spring.data.redis.host/port` 换成 `spring.data.redis.cluster.nodes`，填部分节点即可（Lettuce 会自动发现其余）。',
        '集群模式下不支持跨 slot 的多 key 事务 / lua；key 要用 `{}` 哈希标签保证落在同一 slot。',
        '客户端连接用 `RedisClusterConfiguration`，不要自己维护节点列表。',
      ],
    },
  },

  mysql: {
    name: 'MySQL',
    intro: '关系型主数据库。8.0 起默认 utf8mb4，字符集坑基本消失。',
    install: {
      linux: [
        {
          title: 'Debian / Ubuntu 安装并初始化',
          lang: 'bash',
          code: 'sudo apt update\nsudo apt install -y mysql-server\nsudo systemctl enable --now mysql\nsudo mysql_secure_installation',
        },
        {
          title: '建库与业务账号（别用 root 跑应用）',
          lang: 'sql',
          code:
            "CREATE DATABASE app DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;\nCREATE USER 'app'@'%' IDENTIFIED BY '<强密码>';\nGRANT ALL PRIVILEGES ON app.* TO 'app'@'%';\nFLUSH PRIVILEGES;",
        },
      ],
      docker: [
        {
          title: '带 utf8mb4 与初始化库',
          lang: 'bash',
          code:
            'docker run -d --name mysql \\\n  -e MYSQL_ROOT_PASSWORD=<强密码> \\\n  -e MYSQL_DATABASE=app \\\n  -e MYSQL_USER=app -e MYSQL_PASSWORD=<强密码> \\\n  -p 3306:3306 \\\n  mysql:8.0.36 \\\n  --character-set-server=utf8mb4 \\\n  --collation-server=utf8mb4_general_ci',
        },
      ],
      mac: [
        {
          title: 'Homebrew',
          lang: 'bash',
          code: 'brew install mysql@8.0\nbrew services start mysql@8.0',
        },
      ],
    },
    cluster: {
      modes: ['mgr', 'masterslave', 'sharded'],
      title: 'MySQL 高可用 / 横向扩展',
      intro:
        'masterslave = 一主多从（读写分离）；mgr = MySQL Group Replication（多主/单主自动选主）；sharded = 分库分表（需中间件）。',
      install: {
        linux: [
          {
            title: 'MGR（Group Replication）最小开启项',
            lang: 'bash',
            code:
              '# 每个节点 my.cnf\nserver-id=1\ngtid_mode=ON\nenforce_gtid_consistency=ON\nbinlog_checksum=NONE\nplugin_load_add=group_replication.so\n# 首个节点引导：SET GLOBAL group_replication_bootstrap_group=ON; 再 START GROUP_REPLICATION;',
            note: 'MGR 对网络与时钟敏感，跨机房优先用单主模式。读写分离靠应用层或 ProxySQL 路由。',
          },
        ],
      },
      notes: [
        '分库分表（sharded）通常需要 ShardingSphere 之类中间件，应用侧连接的是逻辑库而不是物理分片。',
        '无论哪种形态，`&rewriteBatchedStatements=true`（JDBC URL 里）都要开，否则 batch 插入退化为逐条，慢十倍。',
      ],
    },
  },

  postgres: {
    name: 'PostgreSQL',
    intro: '关系型主数据库。JSONB / 扩展生态强，地理与向量（pgvector）友好。',
    install: {
      linux: [
        {
          title: 'Debian / Ubuntu 安装并启动',
          lang: 'bash',
          code: 'sudo apt update\nsudo apt install -y postgresql-16\nsudo systemctl enable --now postgresql',
        },
        {
          title: '建库与业务账号',
          lang: 'bash',
          code:
            'sudo -u postgres psql -c "CREATE DATABASE app;"\nsudo -u postgres psql -c "CREATE USER app WITH PASSWORD \'<强密码>\';"\nsudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE app TO app;"',
        },
      ],
      docker: [
        {
          title: '带向量扩展的常用镜像',
          lang: 'bash',
          code:
            'docker run -d --name pg \\\n  -e POSTGRES_PASSWORD=<强密码> \\\n  -e POSTGRES_DB=app \\\n  -p 5432:5432 \\\n  pgvector/pgvector:pg16',
        },
      ],
      mac: [
        {
          title: 'Homebrew',
          lang: 'bash',
          code: 'brew install postgresql@16\nbrew services start postgresql@16',
        },
      ],
    },
  },

  rabbitmq: {
    name: 'RabbitMQ',
    intro: '消息队列。支持多种交换机路由、死信队列、手工 ack，适合需要可靠投递的业务事件。',
    install: {
      linux: [
        {
          title: 'Debian / Ubuntu 安装并启动',
          lang: 'bash',
          code: 'sudo apt update\nsudo apt install -y rabbitmq-server\nsudo systemctl enable --now rabbitmq-server',
        },
        {
          title: '建账号 + 开管理插件',
          lang: 'bash',
          code:
            'sudo rabbitmqctl add_user app <强密码>\nsudo rabbitmqctl set_user_tags app administrator\nsudo rabbitmqctl set_permissions -p / app ".*" ".*" ".*"\nsudo rabbitmq-plugins enable rabbitmq_management',
          note: '管理后台在 15672；默认 guest/guest 只能本机登录，生产务必建独立账号。',
        },
      ],
      docker: [
        {
          title: '带管理后台的镜像',
          lang: 'bash',
          code: 'docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3.13-management',
        },
      ],
      mac: [
        {
          title: 'Homebrew',
          lang: 'bash',
          code: 'brew install rabbitmq\nbrew services start rabbitmq',
        },
      ],
    },
  },

  kafka: {
    name: 'Kafka',
    intro: '高吞吐分布式事件流。3.7 起默认 KRaft 模式，不再依赖 ZooKeeper。',
    install: {
      docker: [
        {
          title: 'KRaft 单 broker（开发）',
          lang: 'bash',
          code: 'docker run -d --name kafka -p 9092:9092 apache/kafka:3.7.0',
        },
        {
          title: '3 broker 集群（开发用，挂同一网络）',
          lang: 'bash',
          code:
            'docker network create kafka\nfor b in 1 2 3; do\n  docker run -d --name kafka-$b --network kafka -p 909$b:9092 \\\n    -e CLUSTER_ID=$(docker run --rm apache/kafka:3.7.0 /opt/kafka/bin/kafka-storage.sh random-uuid) \\\n    -e KAFKA_NODE_ID=$b \\\n    -e KAFKA_PROCESS_ROLES=broker,controller \\\n    -e KAFKA_CONTROLLER_QUORUM_VOTERS="1@kafka-1:9093,2@kafka-2:9093,3@kafka-3:9093" \\\n    apache/kafka:3.7.0\ndone',
        },
      ],
      linux: [
        {
          title: '下载 tarball 并以 KRaft 启动',
          lang: 'bash',
          code:
            'wget https://archive.apache.org/dist/kafka/3.7.0/kafka_2.13-3.7.0.tgz\ntar xzf kafka_2.13-3.7.0.tgz\ncd kafka_2.13-3.7.0\nKAFKA_CLUSTER_ID=$(bin/kafka-storage.sh random-uuid)\nbin/kafka-storage.sh format -t $KAFKA_CLUSTER_ID -c config/kraft/server.properties\nbin/kafka-server-start.sh config/kraft/server.properties',
        },
      ],
      mac: [
        {
          title: 'Homebrew',
          lang: 'bash',
          code: 'brew install kafka\nbrew services start kafka',
        },
      ],
    },
  },
};

export interface SelectedGuide {
  dimId: string;
  optionId: string;
  optionName: string;
  guide: ServerGuide;
  /** 当前为该组件选中的形态（来自 meta.topology[dimId]），可能为空 */
  mode: string | null;
  /** 该形态是否触发了 cluster 部署说明 */
  clusterActive: boolean;
}

import { dimensionById } from '@/lib/stack';

/** 从当前选型 + 形态里挑出所有带服务器部署指引的组件 */
export function getSelectedGuides(
  picks: Record<string, string>,
  meta: { topology: Record<string, string> }
): SelectedGuide[] {
  const out: SelectedGuide[] = [];
  for (const [dimId, optionId] of Object.entries(picks)) {
    if (!optionId) continue;
    const guide = DEPLOY_GUIDES[optionId];
    if (!guide) continue;
    const dim = dimensionById.get(dimId);
    const optionName = dim?.options.find((o) => o.id === optionId)?.name ?? guide.name;
    const mode = meta.topology[dimId] ?? null;
    const clusterActive = !!guide.cluster && !!mode && guide.cluster.modes.includes(mode);
    out.push({ dimId, optionId, optionName, guide, mode, clusterActive });
  }
  return out;
}
