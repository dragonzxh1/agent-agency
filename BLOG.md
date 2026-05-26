# 我如何在 Claude Code 的多层代理中实现了角色自动透传

> 一个 Hook、一行关键代码、一次对 agentcrow 源码的逆向分析。

---

## 问题：子代理在"裸奔"

Claude Code 的子代理（Sub-agent）功能很强大——你可以让一个代理生成另一个代理来分担工作。GSD（Get Shit Done）工作流就是基于这个机制：`gsd-executor` 作为总执行者，在需要时生成 `gsd-codebase-mapper` 分析代码结构、`gsd-planner` 制定子计划、`gsd-verifier` 验证结果。

这套系统还维护了一个"角色注入"机制：248 个专家角色文件（前端开发者、安全工程师、Git 工作流大师……），每个 GSD 命令在生成子代理时注入对应的角色。比如 `/gsd-execute-phase` 会为子代理注入三个角色：前端开发者（关注性能和 WCAG）、Git 工作流大师（原子化提交）、最小变更工程师（克制修改范围）。

**问题出在代理嵌套上**。

主会话生成 `gsd-executor` 时，编排层手动调用了注入脚本，角色成功注入。但当 `gsd-executor` 自己再生成 `gsd-codebase-mapper` 时，没有人帮它调注入脚本——二级代理收不到任何角色上下文。

随着一个 GSD 命令可能产生几十个代理调用，大部分实际干活的代理都在"裸奔"——没有专业视角的约束。

---

## 第一次尝试：缓存文件 + 代理补丁

既然运行时限制钩子不能修改 Agent 的 prompt，那就走旁路。

**设计**：
1. 钩子每次触发时，把角色上下文写入 `.planning/.gsd-injection.txt`
2. 代理补丁脚本在 33 个 GSD 代理定义文件中插入 `<role_pass_through>` 规则——"生成子代理前先读缓存"
3. 升级监听器检测 gstack 升级后自动重新打补丁

**结果**：功能上可以工作。代理读取缓存文件后能正确识别所有角色。补丁脚本幂等（二次运行 0 改动）。升级监听器能检测升级事件并触发补丁。

**问题**：依赖 33 个代理文件保持补丁状态，升级有时间窗口风险，worktree 下路径可能不一致。

---

## 关键发现：updatedInput 的正确用法

### 线索一：Hookify 和官方文档

用户安装了 Hookify 插件，促使我重新审视 Claude Code Hook API。官方文档显示 PreToolUse 钩子支持 `updatedInput` 字段——在工具执行前修改其输入参数。

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow",
    "updatedInput": { "prompt": "修改后的 prompt" }
  }
}
```

### 第一次尝试：只传要改的字段

```javascript
updatedInput: { prompt: enhancedPrompt }
```

**失败**：钩子成功执行，代理报告"没有看到角色标记"。运行时静默忽略了修改。

### 第二次尝试：用 additionalContext

将完整的角色上下文放入 `additionalContext`（系统提醒字段）。

**失败**：内容出现在主会话的 `<system-reminder>` 中，但不会传递给被生成的代理。`additionalContext` 是发给**调用方**的。

### 突破口：读 agentcrow 源码

agentcrow 是一个 npm 包，功能和我们的需求一致——通过 PreToolUse 钩子将专家人格注入子代理。直接安装后读它的核心注入逻辑：

```bash
npm install -g agentcrow
cat node_modules/agentcrow/dist/commands/inject.js
```

在第 358-370 行发现了关键差异：

```javascript
// agentcrow 的写法
const updatedInput = {
    ...toolInput,           // ← 展开所有原始字段！
    prompt: enhancedPrompt, // 仅覆盖 prompt
};
```

我们只传了 `{ prompt: ... }`，但 agentcrow 传了**全部原始字段**（`subagent_type`、`description`、`name` 等）再覆盖 prompt。

**根因**：Claude Code 运行时对 `updatedInput` 做的是全量替换而非字段合并。只传 prompt 时缺少必需字段，运行时认为输入不完整，丢弃修改。

---

## 最终方案：一行关键代码

修复后的钩子输出：

```javascript
const output = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: {
      ...data.tool_input,   // 展开全部原始字段
      prompt: enhancedPrompt // 覆盖 prompt
    }
  }
};
```

**工作原理**：

```
任何层级调用 Agent(gsd-*, prompt)
  → PreToolUse 钩子触发
    → 读取角色映射配置
    → 格式化角色上下文
    → 拼接到原始 prompt 前面
    → 输出 updatedInput（展开全部 tool_input）
  → 运行时接受修改 → 代理以增强 prompt 启动
  → 代理再生代理 → 钩子再次触发 → 无限层级透传
```

---

## 测试：从 L1 到 L5

### L1：管道模拟

```bash
echo '{"tool_name":"Agent","tool_input":{...}}' \
  | node agent-agency-inject.js
```

验证 JSON 结构中 `updatedInput.prompt` 包含角色标记。

### L3：端到端——代理真的收到了吗

```
Agent(gsd-codebase-mapper, prompt:
  "Check your context for '🎭 注入的专业视角'. Report which roles.")
```

第一轮（只传 prompt）：**no role context found** ❌
第二轮（展开全部字段）：**Three roles: Frontend Developer, Git Workflow Master, Minimal Change Engineer** ✅

### L4：二级透传

生成 gsd-executor，命令它再生成 gsd-codebase-mapper 并询问。gsd-executor 确认自己看到了三个角色。

### L5：升级存活

- gstack 1.34 → 1.45（跨 11 个版本，3 个迁移脚本）
- GSD 1.42.3（最新）

升级后钩子文件和注册均完好，L3 测试通过。

| 测试 | 方法 | 结果 |
|------|------|------|
| 钩子输出格式 | Bash 管道模拟 | ✅ |
| 代理读缓存 | Agent prompt 指令 | ✅ |
| updatedInput 注入 | Agent 自我检查 | ✅ |
| 二级透传 | Agent → Agent 嵌套 | ✅ |
| gstack 升级回归 | 1.34→1.45 后 L3 | ✅ |
| GSD 更新回归 | 1.42.3 后 L3 | ✅ |

---

## 架构决策

**钩子放用户空间**：`~/.claude/hooks/` 不在 gstack/GSD 管理范围内，升级永远不会触碰。

**静默失败**：所有异常 `exit(0)`——角色注入是增强而非必需，绝不能阻塞代理生成。

**保留缓存兜底**：`updatedInput` 方案已覆盖所有场景，但缓存文件写入保留作为 worktree 等边缘情况的额外保障。

---

## 教训

1. **读源码比读文档有用**：agentcrow 的 374 行 inject.js 揭示了官方文档没写的关键行为——`updatedInput` 是全量替换

2. **端到端测试不可替代**：管道模拟输出正确 ≠ 代理真的收到了。只有生成真实代理并直接询问，才能确认 prompt 确实被修改

3. **静默失败让调试极难**：钩子写个 verbose 模式输出诊断日志，生产再关掉

4. **过渡方案有价值**：虽然最终方案只需一个钩子，但过渡方案的测试验证了整个角色透传的业务逻辑是正确的

---

## 代码

完整项目（钩子 + 配置 + 示例角色 + 一键安装 + 完整测试方法）：

[agent-agency on GitHub](https://github.com/你的用户名/agent-agency)

核心钩子 150 行，安装只需 `node install.js`。配置用 JSON，三种匹配策略（命名空间、关键词、默认回退）。
