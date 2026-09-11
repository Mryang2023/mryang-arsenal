package com.arsenal.loader;

import com.arsenal.domain.Rule;
import com.arsenal.domain.RulesetMeta;

import java.nio.file.Path;
import java.util.List;

/**
 * 从磁盘加载出来的规则集快照。
 * 不可变 —— 规则集在进程生命周期内不热更新（改规则请重启，或走 Git 提交流程）。
 */
public record LoadedRuleset(
        RulesetMeta meta,
        List<Rule> rules,
        List<Path> files
) {
    public LoadedRuleset {
        rules = List.copyOf(rules);
        files = List.copyOf(files);
    }
}
