# Agent-Agency

> 一个 Claude Code PreToolUse 钩子。为子代理自动注入专家角色，无限层级透传。

## 一句话

每次你（或你的代理）生成一个子代理，这个钩子自动把对应领域的专家规则注入到它的 prompt 里。子代理再生子代理，规则继续透传。

## 为什么需要它

Claude Code 的子代理是"白板"——你让它写代码，它不知道要遵守 Core Web Vitals；你让它提交代码，它不知道要原子化提交。你可以写在 CLAUDE.md 里，但那是全局的，浪费 token，而且子代理不一定看。

Agent-Agency 在代理生成的瞬间注入**刚好需要的规则**——测试代理拿到 QA 规则，前端代理拿到性能规则，执行代理拿到最小变更规则。

## 安装

```bash
git clone https://github.com/你的用户名/agent-agency.git
cd agent-agency
node install.js
```

安装做了什么：
1. 复制钩子和角色到 `~/.agent-agency/`
2. 在 `~/.claude/settings.json` 注册 PreToolUse 钩子
3. 如果 `~/.agent-agency/config.json` 不存在，从示例创建

## 配置

编辑 `~/.agent-agency/config.json`：

```json
{
  "namespace_rules": {
    "gsd-executor": [
      { "file": "engineering/frontend-developer.md", "priority": "primary" },
      { "file": "engineering/git-workflow-master.md", "priority": "secondary" }
    ]
  },
  "keyword_rules": {
    "test,spec,qa": [
      { "file": "testing/qa-engineer.md", "priority": "primary" }
    ]
  },
  "default_roles": [
    { "file": "engineering/minimal-change-engineer.md", "priority": "secondary" }
  ]
}
```

**三种匹配策略（按优先级）**：

| 策略 | 触发条件 | 典型用途 |
|------|---------|---------|
| namespace_rules | 子代理类型精确匹配 | GSD 代理：`gsd-executor` → 前端 + Git + 最小变更 |
| keyword_rules | prompt 中含关键词 | "write tests" → QA 工程师角色 |
| default_roles | 前两种都没命中 | 所有代理至少收到最小变更规则 |

## 角色文件格式

```markdown
---
name: 前端开发者
description: 简短描述
---

## 身份与记忆
- **角色**：做什么的
- **性格**：风格特征
- **记忆**：关键经验

## 核心使命
1. 具体任务 1
2. 具体任务 2

## 关键规则
1. 硬性规则 1
2. 硬性规则 2
```

放在 `~/.agent-agency/roles/` 下，按类别分目录。钩子自动提取三节（匹配子串，兼容 emoji 前缀等变体），单角色 ≤ 400 tokens（主）/ 300 tokens（辅）。

## 测试

```bash
# 1. 设置当前上下文（GSD 用 ~/.gsd-active-command.json，可以用任意方式）
echo '{"command":"gsd-execute-phase","cwd":"/your/project"}' \
  > ~/.claude/.gsd-active-command.json

# 2. 模拟 Agent 调用，查看钩子输出
echo '{"tool_name":"Agent","tool_input":{
  "subagent_type":"gsd-executor",
  "prompt":"Write a React component"
}}' | node ~/.agent-agency/hooks/agent-agency-inject.js

# 3. 如果配置正确，输出 JSON 中 updatedInput.prompt
#    应包含 "## 🎭 注入的专业视角" 标记
```

## 它不是什么

- 不是代理框架——不创建代理，只为已有代理注入上下文
- 不是 agentcrow——不按代理类型自动匹配角色，而是按你的配置规则
- 不是 prompt 模板——不替换你的 prompt，只是在前面拼接角色上下文

## 技术要点

核心机制就一行：

```javascript
updatedInput: { ...data.tool_input, prompt: enhancedPrompt }
```

必须展开全部 `tool_input` 字段（`subagent_type`、`description` 等），运行时做的是全量替换。只传 `{ prompt: ... }` 会被静默忽略。

详见 [BLOG.md](./BLOG.md)——完整记录了从发现问题到最终方案的整个过程，包括四次方案迭代、对 agentcrow 源码的逆向分析、以及完整的测试矩阵。
