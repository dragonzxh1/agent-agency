#!/usr/bin/env node
// agent-agency — inject specialist roles into Claude Code sub-agents via PreToolUse hook.
// One hook file. Every Agent(role-*) call gets the right specialist lenses. All nesting levels.
//
// Usage: register in ~/.claude/settings.json:
//   "PreToolUse": [{ "matcher": "Agent", "hooks": [{
//     "command": "node ~/.agent-agency/hooks/agent-agency-inject.js"
//   }] }]

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ──────────────────────────────────────────────────────────
const CONFIG_FILE =
  process.env.AGENT_AGENCY_CONFIG ||
  path.join(os.homedir(), '.agent-agency', 'config.json');

const ROLES_DIR =
  process.env.AGENT_AGENCY_ROLES ||
  path.join(os.homedir(), '.agent-agency', 'roles');

// ── Load config ─────────────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return null; }
}

// ── Token estimation ────────────────────────────────────────────────
function estimateTokens(text) {
  let cjk = 0, other = 0;
  for (const ch of text) {
    /[\u4e00-\u9fff]/.test(ch) ? cjk++ : other++;
  }
  return Math.ceil(cjk + other / 4);
}

// ── Extract role sections ───────────────────────────────────────────
function loadRole(roleFile) {
  const filePath = path.join(ROLES_DIR, roleFile);
  if (!fs.existsSync(filePath)) return null;

  const lines = fs.readFileSync(filePath, 'utf8').split('\n');

  let name = roleFile.replace('.md', '');
  let inFM = false;
  for (const l of lines) {
    if (l.trim() === '---') { inFM = !inFM; continue; }
    if (inFM) { const m = l.match(/^name:\s*(.+)/); if (m) name = m[1].trim(); }
  }

  function extract(keyword, max) {
    const idx = lines.findIndex(l => l.includes(keyword));
    if (idx === -1) return [];
    const r = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i]) || lines[i].trim() === '---') break;
      const t = lines[i].trim();
      if (t) r.push(t);
    }
    return r.slice(0, max);
  }

  const identity = extract('身份与记忆', 3);
  const mission = extract('核心使命', 4).filter(l => /^\d+\./.test(l));
  const rules   = extract('关键规则', 4).filter(l => /^\d+\./.test(l));

  if (!identity.length && !mission.length && !rules.length) return null;
  return { name, identity, mission, rules };
}

// ── Format role block ───────────────────────────────────────────────
function formatRole(role, budget) {
  const parts = [`## 🎭 注入的专业视角：${role.name}`];
  if (role.identity.length)
    parts.push('\n### 身份\n' + role.identity.join('\n'));
  if (role.mission.length)
    parts.push('\n### 核心使命\n' + role.mission.join('\n'));
  if (role.rules.length)
    parts.push('\n### 关键规则\n' + role.rules.join('\n'));

  let text = parts.join('\n');
  while (estimateTokens(text) > budget) {
    const ln = text.lastIndexOf('\n');
    if (ln === -1) break;
    text = text.substring(0, ln);
  }
  return text;
}

// ── MAIN ────────────────────────────────────────────────────────────
let input = '';
const timeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== 'Agent') process.exit(0);

    const cfg = loadConfig();
    if (!cfg) process.exit(0);

    // Determine which roles to inject.
    // Strategy 1: exact match on subagent_type's namespace prefix (e.g. "gsd-" → "gsd")
    // Strategy 2: keyword match against prompt + description
    // Strategy 3: default roles from config
    const ti = data.tool_input || {};
    const agentType = ti.subagent_type || '';
    const searchText = [ti.prompt, ti.description, ti.name, agentType]
      .filter(Boolean).join(' ').toLowerCase();

    let roles = [];

    // Strategy 1: namespace match
    const nsPrefix = cfg.namespace_rules?.[agentType];
    if (nsPrefix) roles = nsPrefix;

    // Strategy 2: keyword match (if no namespace hit)
    if (roles.length === 0 && cfg.keyword_rules) {
      for (const [keyword, roleList] of Object.entries(cfg.keyword_rules)) {
        if (searchText.includes(keyword.toLowerCase())) {
          roles = roleList;
          break;
        }
      }
    }

    // Strategy 3: fallback defaults
    if (roles.length === 0 && cfg.default_roles) {
      roles = cfg.default_roles;
    }

    if (roles.length === 0) process.exit(0);

    // Load and format roles
    const blocks = [];
    for (const r of roles) {
      const data = loadRole(r.file);
      if (!data) continue;
      const budget = r.priority === 'primary' ? 400 : 300;
      const block = formatRole(data, budget);
      if (block) blocks.push(block);
    }

    if (blocks.length === 0) process.exit(0);

    const injection = blocks.join('\n\n---\n\n');
    const separator = '\n\n---\n\n## 📋 原始任务\n\n';
    const enhancedPrompt = injection + separator + (ti.prompt || '');

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          ...data.tool_input,
          prompt: enhancedPrompt
        }
      }
    };

    process.stdout.write(JSON.stringify(output));
  } catch (_) {
    process.exit(0);
  }
});
