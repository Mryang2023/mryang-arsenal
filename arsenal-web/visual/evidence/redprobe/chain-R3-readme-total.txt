
> arsenal-web@0.1.0 verify:meta
> tsx .verify/meta-check.ts

元核对（verify:meta）—— 让「各层跑了多少项」由机器守门
读 `.verify/tmp/layer-<key>.json`（由 `.verify/lib/report.ts` 的 finish() 写出）

【1】事实源（arsenal-profiles/arsenal.json）
  ✓ 档案：能读到 project.verifyChain

【2】生成物 vs 事实源（忘了 sync-content 就会红）
  ✓ 生成物：能读到 profiles.*.project.verifyChain
  ✓ 生成物与事实源逐层相同

【3】逐层：层写出的实测项数 vs 档案声明值
  ✓ 元核对：架构判定 的字段齐全（pass/fail/skip）
  ✓ 元核对：架构判定 状态文件的层名一致
  ✓ 元核对：架构判定 自带的声明值 = 元核对读到的档案值
  ✓ 元核对：架构判定 声明 35 / 实测 35
  ✓ 元核对：图与交互 的字段齐全（pass/fail/skip）
  ✓ 元核对：图与交互 状态文件的层名一致
  ✓ 元核对：图与交互 自带的声明值 = 元核对读到的档案值
  ✓ 元核对：图与交互 声明 59 / 实测 59
  ✓ 元核对：结构与导出 的字段齐全（pass/fail/skip）
  ✓ 元核对：结构与导出 状态文件的层名一致
  ✓ 元核对：结构与导出 自带的声明值 = 元核对读到的档案值
  ✓ 元核对：结构与导出 声明 406 / 实测 406
  ✓ 元核对：场景案例 的字段齐全（pass/fail/skip）
  ✓ 元核对：场景案例 状态文件的层名一致
  ✓ 元核对：场景案例 自带的声明值 = 元核对读到的档案值
  ✓ 元核对：场景案例 声明 33 / 实测 33
  ✓ 元核对：引擎样本 的字段齐全（pass/fail/skip）
  ✓ 元核对：引擎样本 状态文件的层名一致
  ✓ 元核对：引擎样本 自带的声明值 = 元核对读到的档案值
  ✓ 元核对：引擎样本 声明 17 / 实测 17
  ✓ 元核对：前后端一致性 的字段齐全（pass/fail/skip）
  ✓ 元核对：前后端一致性 状态文件的层名一致
  ✓ 元核对：前后端一致性 自带的声明值 = 元核对读到的档案值
  ✓ 元核对：前后端一致性 声明 12 / 实测 12
  ✓ 元核对：Archify 链路 的字段齐全（pass/fail/skip）
  ✓ 元核对：Archify 链路 状态文件的层名一致
  ✓ 元核对：Archify 链路 自带的声明值 = 元核对读到的档案值
  ~ 元核对：Archify 链路 的项数独立核对
      未执行：本层整层未执行（countSource=declared）—— 那个「31 项未执行」取自档案声明值，不是测量结果，拿它比声明值等于自己给自己出题
  ✓ 元核对：代码扫描 的字段齐全（pass/fail/skip）
  ✓ 元核对：代码扫描 状态文件的层名一致
  ✓ 元核对：代码扫描 自带的声明值 = 元核对读到的档案值
  ✓ 元核对：代码扫描 声明 69 / 实测 69
  ✓ 元核对：视觉断言 的字段齐全（pass/fail/skip）
  ✓ 元核对：视觉断言 状态文件的层名一致
  ✗ 元核对：视觉断言 自带的声明值 = 元核对读到的档案值
      状态文件里 11 / 档案当前 12（层读的档案与元核对读的不是同一份？或有 ARSENAL_LAYER_DECLARED 覆盖）
  ✓ 元核对：视觉断言 声明 12 / 实测 12

【4】比对范围本身也要对得上
  ✓ 比对范围：九个层 key 都能在档案 verifyChain 里找到同名条目
  ✓ 比对范围：档案里没有元核对不认识的层
  ✓ 比对范围：verifyChain 里每层项数都是正数
  ✓ 比对范围：.verify/tmp 里没有链接外的 layer-*.json 残留

【5】README 的两处派生数字（手抄件也归机器管）
  ✗ README 总数句 = 各层声明之和（README 673 / 档案 674）
      README 写「共 **673 项**」，而档案 verifyChain 之和是 674
  ✓ README 分项表：verify:arch = 35（README 35）
  ✓ README 分项表：verify:graph = 59（README 59）
  ✓ README 分项表：verify:project = 406（README 406）
  ✓ README 分项表：verify:cases = 33（README 33）
  ✓ README 分项表：verify:engine = 17（README 17）
  ✓ README 分项表：verify:parity = 12（README 12）
  ✓ README 分项表：verify:archify = 31（README 31）
  ✓ README 分项表：verify:scan = 69（README 69）
  ✓ README 分项表：verify:visual = 12（README 12）

【6】逐层清单
层                声明    实测    跳过    失败    来源        结论
──────────────────────────────────────────────────────────────────────────────
架构判定          35      35      0       0       实测        对得上
图与交互          59      59      0       0       实测        对得上
结构与导出        406     406     0       0       实测        对得上
场景案例          33      33      0       0       实测        对得上
引擎样本          17      17      0       0       实测        对得上
前后端一致性      12      12      3       0       实测        对得上
Archify 链路      31      31      31      0       声明值填充  未核对（整层未执行）
代码扫描          69      69      0       0       实测        对得上
视觉断言          12      12      0       0       实测        对得上
──────────────────────────────────────────────────────────────────────────────
九层合计          674     674     34      0       
（「实测」列 = 通过 + 失败 + 未执行，与「声明」同量纲；元核对自身不计入九层项数）

刻意未跑 2 项（不算跳过、不算失败、也不进项数合计 —— 它们没被执行过）
  ~ 代码扫描 · 5-4 总字节 500MB 闸门的真实超限（造 500MB 用例）
  ~ 代码扫描 · 8-6 真等 180s 超时（真实等待）
  （`npm run verify -- --strict` 会把它们判成失败）

未核对（项数无从独立核对 —— 不计通过，也不计失败）
  ~ Archify 链路（整层未执行，31 项）

汇总产物：.verify/tmp/layer-counts.json

────────────────────────────────────────────────────────
实测 50 项 / 跳过 1 项 / 失败 2 项
  ~ 未执行：元核对：Archify 链路 的项数独立核对
ARSENAL-LAYER-STATUS {"layer":"meta","name":"元核对","pass":50,"fail":2,"skip":1,"measured":52,"total":53,"declared":null,"declaredMismatch":null,"countSource":"measured","knowinglySkipped":0,"knowinglyNames":[],"exitCode":1,"skipped":["元核对：Archify 链路 的项数独立核对"]}
