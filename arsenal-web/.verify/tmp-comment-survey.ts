import { buildExportArtifacts } from '@/lib/scaffold/artifacts';
import { resolveModules } from '@/lib/scaffold/module-registry';
import { emptyPicks } from '@/lib/stack';
const vars = { basePackage:'com.example', basePackagePath:'com/example', artifactId:'demo', appName:'demo', backendBaseUrl:'http://127.0.0.1:8080', dbImage:'mysql:8' };
const p = { ...emptyPicks(), jdk:'jdk17', build:'maven', runtime:'webmvc', persistence:'mybatisplus', database:'mysql', pool:'hikari', migration:'flyway', auth:'securityjwt', cache:'redis', mq:'none', register:'nacos', scheduler:'none', apidoc:'springdoc', obs:'actuator', mapping:'mapstruct', testing:'junit5', quality:'jacoco' } as any;
const mods = resolveModules(['user','menu'], p, 'vue3-vite').selected;
const arts = buildExportArtifacts(p, { projectName:'demo', baseId:'springboot3-jdk17', env:{values:{},demoMode:false}, modules:mods, feBase:'vue3-vite', feUi:'element-admin', vars });
// 注释密度普查：Java 文件里注释行占比
const java = arts.backend.files.filter((f) => f.path.endsWith('.java'));
const rows = java.map((f) => {
  const lines = f.content.split('\n');
  const comments = lines.filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l)).length;
  return { path: f.path.replace('src/main/java/com/example/',''), total: lines.length, pct: Math.round((comments / lines.length) * 100) };
}).sort((a, b) => a.pct - b.pct);
console.log(`Java 文件 ${rows.length} 个；注释占比最低的 15 个：`);
for (const r of rows.slice(0, 15)) console.log(`  ${String(r.pct).padStart(3)}%  ${r.total} 行  ${r.path}`);
const zero = rows.filter((r) => r.pct === 0);
console.log(`零注释文件数：${zero.length}`);
// build.gradle / application.yml 头部
console.log('--- build.gradle 前 3 行 ---');
console.log(arts.backend.files.find((f) => f.path === 'build.gradle')?.content.split('\n').slice(0,3).join('\n'));
