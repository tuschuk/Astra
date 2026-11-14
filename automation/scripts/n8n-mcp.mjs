#!/usr/bin/env node
/**
 * Launcher for the n8n MCP server that loads secrets from the repo's .env file.
 *
 * Why it exists: Claude Code starts MCP servers from .mcp.json but does not read a repo .env,
 * and we keep the n8n API key out of .mcp.json so that file can be committed. This wrapper
 * reads .env (KEY=VALUE lines, # comments ignored), merges it into the environment, and then
 * runs `npx -y n8n-mcp` with stdio passed straight through — the MCP protocol flows over
 * stdin/stdout untouched.
 *
 * Without N8N_API_KEY set, n8n-mcp still works in docs-only mode (node documentation, no live
 * board management), so a missing or empty .env is not an error.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Parse KEY=VALUE lines from .env; blank lines and # comments are skipped. */
function loadEnvFile(file) {
  const vars = {};
  let text = '';
  try {
    text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {
    return vars; // No .env yet — run docs-only.
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Strip optional surrounding quotes so `KEY="value"` and `KEY=value` both work.
    const value = trimmed.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (value) vars[key] = value;
  }
  return vars;
}

const child = spawn('npx', ['-y', 'n8n-mcp'], {
  stdio: 'inherit',
  shell: true, // npx is npx.cmd on Windows; shell resolves it.
  env: {
    MCP_MODE: 'stdio',
    LOG_LEVEL: 'error',
    DISABLE_CONSOLE_OUTPUT: 'true',
    N8N_API_URL: 'http://localhost:5678',
    ...process.env,
    ...loadEnvFile(path.join(repoRoot, '.env')),
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
