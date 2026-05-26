<p align="center">
  <h1 align="center">🐦 Agent-Agency</h1>
  <p align="center">
    <b>自动为 Claude Code 子代理注入专家角色</b><br>
    <sub>一个钩子。无限层级。零依赖。</sub>
  </p>
</p>

<p align="center">
  <a href="./README.md">English Docs</a>
</p>

---

## 问题

Claude Code 的子代理出生时是一张"白板"。你生成一个代理让它写代码——它不知道要遵守 Core Web Vitals。你生成一个代理让它提交代码——它不知道要原子化提交。你当然可以把所有规则塞进 CLAUDE.md，但那影响全局、浪费 token、而且子代理可能根本不看。

Agent-Agency 在代理生成的**瞬间**注入刚好需要的规则。测试代理拿到 QA 规则。前端代理拿到性能规则。执行代理拿到最小变更纪律。

## 快速开始

```bash
git clone https://github.com/dragonzxh1/agent-agency.git
cd agent-agency
node install.js
```

安装程序会：
1. 复制钩子和角色文件到 `~/.agent-agency/`
2. 在 `~/.claude/settings.json` 中注册 PreToolUse 钩子
3. 如果 `~/.agent-agency/config.json` 不存在，从示例模板创建

## 工作原理

```
任意代码调用 Agent(subagent_type, prompt)
  ↓
PreToolUse 钩子拦截
  ↓ 读取配置：这种代理配哪些角色？
  ↓ 读取角色文件：身份 + 使命 + 规则
  ↓ 格式化：## 🎭 注入的专业视角：[角色名]
  ↓ 构建 updatedInput：展开全部 tool_input，覆盖 prompt
  ↓
运行时接受 → 代理以专家视角启动 ✅
  ↓ 代理再生成代理
  ↓ 钩子再次触发——每一层都拦截
  ↓
✅ 无限层级透传
```

## 关键突破

开发过程中，我们撞上了一堵墙。钩子明明触发了，代理却报告"没看到任何角色标记"。`updatedInput` 被静默忽略。

四次失败尝试之后，通过阅读 **agentcrow** 的源码找到了答案：

```javascript
// ❌ 不生效——运行时静默丢弃
updatedInput: { prompt: enhancedPrompt }

// ✅ 生效——展开全部原始字段，再覆盖 prompt
updatedInput: { ...data.tool_input, prompt: enhancedPrompt }
```

**运行时做的是全量替换，不是字段级合并。** 如果你漏了 `subagent_type`、`description` 等字段，输入就不完整，修改被丢弃。这个行为在任何官方文档中都没有记载——是通过逆向分析生产级 npm 包学到的。

## 核心钩子

```javascript
const output = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: {
      ...data.tool_input,   // 保留全部字段：subagent_type, description, name...
      prompt: enhancedPrompt // 前插角色上下文 + 分隔符 + 原始任务
    }
  }
};
```

完整源码：[`hooks/agent-agency-inject.js`](./hooks/agent-agency-inject.js)，约 150 行。

钩子放在 `~/.claude/hooks/` 目录下——这个目录不在 gstack 或 GSD 的管理范围内，升级永远不会触碰。

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

**三种匹配策略**（按优先级检查）：

| 策略 | 触发条件 | 示例 |
|------|---------|------|
| `namespace_rules` | `subagent_type` 精确匹配 | `gsd-executor` → 3 个角色 |
| `keyword_rules` | prompt + description 含关键词 | "write tests" → QA 工程师 |
| `default_roles` | 前两种都没命中时的兜底 | 所有代理至少拿到最小变更规则 |

主角色 400 tokens 预算，辅助角色 300 tokens。

## 角色文件格式

```markdown
---
name: 前端开发者
description: 简短描述
---

## 身份与记忆
- **角色**：你是做什么的
- **性格**：你的风格特征
- **记忆**：关键的经验教训

## 核心使命
1. 具体任务
2. 具体任务

## 关键规则
1. 硬性约束
2. 硬性约束
```

放在 `~/.agent-agency/roles/` 下按类别分目录。钩子用子串匹配提取三个章节（兼容中文 emoji 前缀和命名变体）。

## 测试

```bash
# 1. 模拟 Agent 调用，检查钩子输出
echo '{"tool_name":"Agent","tool_input":{
  "subagent_type":"gsd-executor",
  "prompt":"写一个 React 组件"
}}' | node ~/.agent-agency/hooks/agent-agency-inject.js

# 2. 检查输出 JSON 中 updatedInput.prompt 是否包含角色标记

# 3. 真正的端到端测试：生成一个代理，直接问它
#    "检查你的上下文中是否有注入的角色标记。报告你看到了哪些角色。"
```

## 实测验证

| 测试 | 方法 | 结果 |
|------|------|------|
| 钩子输出格式 | Bash 管道模拟 | ✅ |
| updatedInput 注入 | 代理自我检查 | ✅ |
| 二级透传 | 代理 → 代理嵌套 | ✅ |
| gstack 升级 (1.34→1.45) | 跨 11 个版本、3 个迁移脚本 | ✅ |
| GSD 更新 (1.42.3) | 回归测试 | ✅ |

## 它的定位

- **不是代理框架**——不创建代理，只为已有代理注入上下文
- **不是 agentcrow**——按你的配置规则匹配，而非自动关键词匹配
- **不是 prompt 模板**——在头部拼接角色上下文，不替换你的 prompt

## 为什么钩子放在 `~/.claude/hooks/`？

因为这个目录不在 gstack 或 GSD 的管辖范围内。gstack 升级通过 `git reset --hard` 覆盖 `~/.claude/skills/gstack/`，GSD 升级覆盖 `~/.claude/agents/gsd-*.md`。`~/.claude/hooks/` 和 `~/.claude/settings.json` 是 Claude Code 的用户级配置，这两个升级都不会碰。

我们实测验证了两次大规模升级后钩子完好无损。

## License

MIT
