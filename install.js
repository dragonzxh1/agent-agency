#!/usr/bin/env node
// install.js — one-command setup for agent-agency
// Copies hook + roles to ~/.agent-agency/ and registers the PreToolUse hook in ~/.claude/settings.json.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const SRC = __dirname;
const DST = path.join(HOME, '.agent-agency');
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const HOOK_CMD = process.platform === 'win32'
  ? `node "${DST}/hooks/agent-agency-inject.js"`
  : `node '${DST}/hooks/agent-agency-inject.js'`;

console.log('🐦 Agent-Agency Installer\n');

// 1. Copy files
console.log('1/4  Copying files...');
fs.cpSync(SRC, DST, { recursive: true, filter: (src) => !src.includes('node_modules') && !src.includes('.git') });
console.log(`   → ${DST}`);

// 2. Check if config exists, copy example if not
const configFile = path.join(DST, 'config.json');
if (!fs.existsSync(configFile)) {
  fs.copyFileSync(path.join(DST, 'agent-agency.config.json'), configFile);
  console.log('   → Created config.json from example');
} else {
  console.log('   → config.json already exists (skipped)');
}

// 3. Register hook in settings.json
console.log('2/4  Registering PreToolUse hook...');
let settings = {};
if (fs.existsSync(SETTINGS)) {
  try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {}
}

settings.hooks = settings.hooks || {};
settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

// Check if already registered
const already = settings.hooks.PreToolUse.some(h =>
  h.matcher === 'Agent' &&
  h.hooks?.some(hook => hook.command?.includes('agent-agency-inject'))
);

if (already) {
  console.log('   → Already registered (skipped)');
} else {
  settings.hooks.PreToolUse.push({
    matcher: 'Agent',
    hooks: [{ type: 'command', command: HOOK_CMD }]
  });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  console.log(`   → Registered: Agent → agent-agency-inject.js`);
}

// 4. Validation
console.log('3/4  Validating...');
const checks = [
  ['Hook file', path.join(DST, 'hooks', 'agent-agency-inject.js')],
  ['Config file', configFile],
  ['Roles directory', path.join(DST, 'roles')],
];
let ok = true;
for (const [label, p] of checks) {
  const status = fs.existsSync(p) ? '✓' : '✗';
  if (status === '✗') ok = false;
  console.log(`   ${status} ${label}`);
}

console.log(`4/4  ${ok ? 'Done! Agent-Agency is ready.' : 'Some files missing — check errors above.'}`);
if (ok) {
  console.log('\nNext: edit ~/.agent-agency/config.json to map your sub-agents to roles.');
  console.log('Then spawn any sub-agent — roles will auto-inject.');
}
