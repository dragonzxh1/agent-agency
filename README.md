<p align="center">
  <h1 align="center">🐦 Agent-Agency</h1>
  <p align="center">
    <b>Auto-inject specialist roles into Claude Code sub-agents</b><br>
    <sub>自动为 Claude Code 子代理注入专家角色 · 无限层级透传</sub>
  </p>
</p>

---

One PreToolUse hook. Every sub-agent gets the right specialist lenses — at any nesting depth. No agent left "naked."

一个 PreToolUse 钩子。每个子代理都带上正确的专家视角——无论嵌套多深。没有代理在"裸奔"。

---

## The Problem · 问题

Claude Code sub-agents are born as blank slates. You spawn one to write code — it doesn't know about Core Web Vitals. You spawn one to commit — it doesn't know about atomic commits. You could put everything in CLAUDE.md, but that's global, wastes tokens, and sub-agents may ignore it.

Agent-Agency injects **exactly the right rules at spawn time** — a test agent gets QA rules, a frontend agent gets performance rules, an execution agent gets minimal-change discipline.

Claude Code 的子代理出生时是"白板"。你让它写代码，它不知道要遵守 Core Web Vitals。你让它提交代码，它不知道要原子化提交。你可以写在 CLAUDE.md 里，但那浪费 token，子代理也不一定看。

Agent-Agency 在代理生成的瞬间注入**刚好需要的规则**。

---

## Quick Start · 快速开始

```bash
git clone https://github.com/dragonzxh1/agent-agency.git
cd agent-agency
node install.js
```

What happens:
1. Copies hook and roles to `~/.agent-agency/`
2. Registers a PreToolUse hook in `~/.claude/settings.json`
3. Creates `~/.agent-agency/config.json` from the example

安装做了什么：复制钩子和角色到 `~/.agent-agency/`，注册 PreToolUse 钩子，从示例创建配置文件。

---

## How It Works · 工作原理

```
Any code calls Agent(subagent_type, prompt)
  ↓
PreToolUse hook fires       ← 钩子拦截
  ↓ Reads config            ← 读配置：哪种代理配哪些角色
  ↓ Loads role files        ← 读角色文件：身份 + 使命 + 规则
  ↓ Formats injection       ← 格式化为 ## 🎭 注入的专业视角：[角色名]
  ↓ Builds updatedInput     ← 展开全部 tool_input，覆盖 prompt
  ↓
Runtime accepts → Agent starts with specialist lenses ✅
  ↓ Agent spawns another Agent
  ↓ Hook fires again        ← 钩子在每一层都触发
  ↓
Infinite nesting inheritance ✅
```

---

## The Key Discovery · 关键突破

While building this, we hit a wall: the hook fired, but the agent reported "no role context found." The `updatedInput` was being silently ignored.

Four attempts later, we found the answer by reading **agentcrow**'s source code (`dist/commands/inject.js`, line 358):

在开发过程中，我们碰到了关键障碍：钩子触发了，但代理说"没看到角色"。`updatedInput` 被静默忽略。四次尝试后，通过阅读 agentcrow 的源码找到了答案：

```javascript
// ❌ Doesn't work — runtime silently discards because fields are missing
// 不生效——运行时静默丢弃，因为字段不完整
updatedInput: { prompt: enhancedPrompt }

// ✅ Works — spread ALL original fields, then override prompt
// 生效——展开全部原始字段，再覆盖 prompt
updatedInput: { ...data.tool_input, prompt: enhancedPrompt }
```

**The runtime does full replacement, not field-level merge.** If you omit `subagent_type`, `description`, etc., the input is invalid and the modification is dropped. This behavior is not documented anywhere — we learned it by reverse-engineering a production npm package.

**运行时做的是全量替换，不是字段合并。** 缺少 `subagent_type` 等字段时，输入不完整，修改被丢弃。这个行为在任何官方文档中都没有说明——是通过逆向分析一个生产级 npm 包学到的。

---

## The Core Hook · 核心钩子

The entire injection logic boils down to one output block. Full source at [`hooks/agent-agency-inject.js`](./hooks/agent-agency-inject.js) (150 lines).

全部注入逻辑归结为这个输出块。完整源码 150 行。

```javascript
const output = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: {
      ...data.tool_input,   // spread all: subagent_type, description, name, ...
      prompt: enhancedPrompt // override: role context + separator + original prompt
    }
  }
};
process.stdout.write(JSON.stringify(output));
```

**Why `~/.claude/hooks/`?** This directory is outside gstack/GSD managed paths. Upgrades never touch it.

**为什么放 `~/.claude/hooks/`？** 这个目录在 gstack/GSD 的管理范围外，升级永远不会触碰。

---

## Configuration · 配置

Edit `~/.agent-agency/config.json`:

```json
{
  "namespace_rules": {
    "gsd-executor": [
      { "file": "engineering/frontend-developer.md", "priority": "primary" },
      { "file": "engineering/git-workflow-master.md", "priority": "secondary" },
      { "file": "engineering/minimal-change-engineer.md", "priority": "secondary" }
    ]
  },
  "keyword_rules": {
    "test,spec,qa": [
      { "file": "testing/qa-engineer.md", "priority": "primary" }
    ],
    "security,audit,vulnerability": [
      { "file": "engineering/security-engineer.md", "priority": "primary" }
    ]
  },
  "default_roles": [
    { "file": "engineering/minimal-change-engineer.md", "priority": "secondary" }
  ]
}
```

**Three matching strategies** (checked in order)：

| Strategy · 策略 | Trigger · 触发条件 | Example · 示例 |
|-----------------|-------------------|----------------|
| `namespace_rules` | Exact match on `subagent_type` | `gsd-executor` → 3 roles |
| `keyword_rules` | Keywords in prompt + description | "write tests" → QA Engineer |
| `default_roles` | Fallback for unmatched agents | All agents get minimal-change rule |

Primary roles get 400 tokens budget, secondary get 300.

主角色 400 tokens 预算，辅助角色 300 tokens。

---

## Role File Format · 角色文件格式

```markdown
---
name: 前端开发者
description: 简短描述
---

## 身份与记忆
- **角色**：做什么的
- **性格**：风格特征
- **记忆**：关键经验教训

## 核心使命
1. 具体任务 1
2. 具体任务 2

## 关键规则
1. 硬性约束 1
2. 硬性约束 2
```

Place in `~/.agent-agency/roles/` by category. The hook extracts three sections by substring match (works with emoji prefixes and naming variants).

放在 `~/.agent-agency/roles/` 下按类别分目录。钩子用子串匹配提取三节。

---

## Testing · 测试

```bash
# 1. Simulate an Agent call
echo '{"tool_name":"Agent","tool_input":{
  "subagent_type":"gsd-executor",
  "prompt":"Write a React component"
}}' | node ~/.agent-agency/hooks/agent-agency-inject.js

# 2. Check output: updatedInput.prompt should contain
#    "## 🎭 注入的专业视角" role markers

# 3. Real end-to-end: spawn an agent and ask it
#    "Check your context for '🎭 注入的专业视角'. Report which roles."
```

**Verified** across gstack upgrades (1.34 → 1.45, 11 versions, 3 migrations) and GSD updates (1.42.3). Hook and registration survived both.

**已验证**跨 gstack 升级（1.34 → 1.45，11 个版本，3 个迁移脚本）和 GSD 更新（1.42.3）。钩子和注册在两次升级后均存活。

---

## What It Is Not · 它不是什么

- **Not an agent framework** — doesn't create agents, only enriches their context · 不是代理框架，不创建代理，只为已有代理注入上下文
- **Not agentcrow** — doesn't auto-match roles by agent type, uses your config rules · 不按代理类型自动匹配，按你的配置规则
- **Not a prompt template** — doesn't replace your prompt, prepends role context · 不替换你的 prompt，在头部拼接角色上下文

---

## Real-World Test Results · 实测结果

| Test · 测试 | Method · 方法 | Result · 结果 |
|-------------|--------------|---------------|
| Hook output format | Bash pipe simulation · 管道模拟 | ✅ |
| Agent reads cache | Agent prompt instruction · 代理读取缓存 | ✅ |
| updatedInput injection | Agent self-check · 代理自我检查 | ✅ |
| 2-level pass-through | Agent → Agent nesting · 代理嵌套 | ✅ |
| gstack upgrade survival | 1.34→1.45 regression · 升级回归 | ✅ |
| GSD update survival | 1.42.3 regression · 更新回归 | ✅ |

---

## Lessons · 教训

1. **Read source code, not docs** · 读源码而非文档：agentcrow's 374-line `inject.js` revealed what the official docs didn't — `updatedInput` is full replacement
2. **E2E tests are irreplaceable** · 端到端测试不可替代：hook output looking correct ≠ agent actually received it
3. **Silent failure is a debugging nightmare** · 静默失败使调试极难：add verbose logging during development
4. **Prototypes have value** · 过渡方案有价值：even discarded approaches validated business logic

---

## License

MIT
