<p align="center">
  <h1 align="center">🐦 Agent-Agency</h1>
  <p align="center">
    <b>Auto-inject specialist roles into Claude Code sub-agents</b><br>
    <sub>One hook. Infinite nesting. Zero dependencies.</sub>
  </p>
</p>

<p align="center">
  <a href="./README.zh.md">中文文档</a>
</p>

---

## The Problem

Claude Code sub-agents are born as blank slates. You spawn one to write code — it doesn't know about Core Web Vitals. You spawn one to commit — it doesn't know about atomic commits. You could put everything in CLAUDE.md, but that's global, wastes tokens, and sub-agents may ignore it.

Agent-Agency injects **exactly the right rules at spawn time**. A test agent gets QA rules. A frontend agent gets performance rules. An execution agent gets minimal-change discipline.

## Quick Start

```bash
git clone https://github.com/dragonzxh1/agent-agency.git
cd agent-agency
node install.js
```

The installer:
1. Copies the hook and roles to `~/.agent-agency/`
2. Registers a PreToolUse hook in `~/.claude/settings.json`
3. Creates `~/.agent-agency/config.json` from the example template

## How It Works

```
Any code calls Agent(subagent_type, prompt)
  ↓
PreToolUse hook intercepts
  ↓ Reads config: which roles for this agent type?
  ↓ Loads role files: identity + mission + rules
  ↓ Formats: ## 🎭 Injected Lens: [Role Name]
  ↓ Builds updatedInput: spread all tool_input, override prompt
  ↓
Runtime accepts → Agent boots with specialist lenses ✅
  ↓ Agent spawns another Agent
  ↓ Hook fires again — at every nesting level
  ↓
✅ Infinite inheritance
```

## The Key Discovery

During development, we hit a wall. The hook fired, but the agent reported "no role context found." `updatedInput` was being silently ignored.

Four failed attempts later, we found the answer by reading **agentcrow**'s source code:

```javascript
// ❌ Doesn't work — runtime silently drops it
updatedInput: { prompt: enhancedPrompt }

// ✅ Works — spread ALL original fields, then override
updatedInput: { ...data.tool_input, prompt: enhancedPrompt }
```

**The runtime does full replacement, not field-level merge.** If you omit `subagent_type`, `description`, etc., the input is incomplete and the modification is dropped. This is undocumented behavior — we learned it through reverse-engineering.

## The Core Hook

```javascript
const output = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: {
      ...data.tool_input,   // keep all: subagent_type, description, name...
      prompt: enhancedPrompt // prepend role context + separator + original
    }
  }
};
```

Full source: [`hooks/agent-agency-inject.js`](./hooks/agent-agency-inject.js) (~150 lines).

The hook lives in `~/.claude/hooks/` — outside gstack/GSD managed paths. Upgrades never touch it.

## Configuration

Edit `~/.agent-agency/config.json`:

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

**Three matching strategies** (checked in order):

| Strategy | Trigger | Example |
|----------|---------|---------|
| `namespace_rules` | Exact match on `subagent_type` | `gsd-executor` → 3 roles |
| `keyword_rules` | Keywords in prompt + description | "write tests" → QA Engineer |
| `default_roles` | Fallback when nothing matches | All agents get minimal-change |

Primary roles: 400 tokens budget. Secondary: 300 tokens.

## Role File Format

```markdown
---
name: Frontend Developer
description: Short description
---

## 身份与记忆 (Identity)
- **Role**: what you do
- **Personality**: your style
- **Memory**: critical experience

## 核心使命 (Mission)
1. Specific task
2. Specific task

## 关键规则 (Rules)
1. Hard constraint
2. Hard constraint
```

Place files in `~/.agent-agency/roles/` organized by category. The hook extracts sections by substring match (works with emoji prefixes and naming variants in Chinese/English).

## Testing

```bash
# 1. Simulate an Agent call
echo '{"tool_name":"Agent","tool_input":{
  "subagent_type":"gsd-executor",
  "prompt":"Write a React component"
}}' | node ~/.agent-agency/hooks/agent-agency-inject.js

# 2. Check output: updatedInput.prompt should contain role markers

# 3. Real E2E: spawn an agent and ask it
#    "Check your context for injected role markers. Report which roles."
```

## Verified

| Test | Method | Result |
|------|--------|--------|
| Hook output format | Bash pipe simulation | ✅ |
| updatedInput injection | Agent self-check | ✅ |
| 2-level pass-through | Agent → Agent nesting | ✅ |
| gstack upgrade (1.34→1.45) | 11 versions, 3 migrations | ✅ |
| GSD update (1.42.3) | Regression test | ✅ |

## What It's Not

- **Not an agent framework** — doesn't create agents, only enriches their context
- **Not agentcrow** — uses your config rules, not auto keyword-matching
- **Not a prompt template** — prepends context, doesn't replace your prompt

## License

MIT
