#!/usr/bin/env node
/**
 * Launcher for the Supabase MCP server that loads secrets from the repo's .env file.
 *
 * Why it exists: Claude Code starts MCP servers from .mcp.json but does not read a repo .env,
 * and we keep the Supabase personal access token out of .mcp.json so that file can be
 * committed. This wrapper reads .env (KEY=VALUE lines, # comments ignored), merges it into the
 * environment, and then runs the official Supabase MCP server with stdio passed straight
 * through — the MCP protocol flows over stdin/stdout untouched.
 *
 * It expects SUPABASE_ACCESS_TOKEN in .env (dashboard -> Account -> Access Tokens). Without
 * it the server starts but every tool call fails with an auth error, so the token line
 * missing is the first thing to check when Supabase MCP tools misbehave.
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
    return vars; // No .env yet — the server will report auth errors on use.
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

const child = spawn(
  'npx',
  ['-y', '@supabase/mcp-server-supabase@latest', '--project-ref=qczhvuzdxpmfztxrifyg'],
  {
    stdio: 'inherit',
    shell: true, // npx is npx.cmd on Windows; shell resolves it.
    env: {
      ...process.env,
      ...loadEnvFile(path.join(repoRoot, '.env')),
    },
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
