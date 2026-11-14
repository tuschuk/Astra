#!/usr/bin/env node
/**
 * Astra pipeline helper — the deterministic glue between n8n and the headless Claude runs.
 * See docs/PIPELINE.md for the whole picture.
 *
 * Subcommands:
 *   next              Pick the first `Not started` item from docs/BUILD_LIST.md, save it to
 *                     automation/state/current-item.json, and print it as JSON. Refuses to run
 *                     if the git working tree is dirty or the repo isn't on main — that's the
 *                     safety catch that keeps the pipeline strictly one-item-at-a-time.
 *   prompt <role>     Fill the planner or builder prompt template with the saved item and print
 *                     it. The run-*.cmd wrappers pipe this into `claude -p`.
 *   check             Self-tests on synthetic data (no git, no file writes). Exits non-zero on
 *                     any failure. Substitutes for Jest while the repo has no test setup.
 *
 * Why it exists: n8n is good at routing and waiting, bad at parsing Markdown tables. This script
 * is the one place that understands the build list's format, so the n8n board stays dumb.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stateDir = path.join(repoRoot, 'automation', 'state');
const stateFile = path.join(stateDir, 'current-item.json');

/**
 * Pull every feature row out of the build-list Markdown.
 * A feature row is a table line whose first cell looks like an item ID (e.g. FND-1, LOG-12).
 * Returns [{id, feature, phase, status, dod}] in document order — which is build order.
 */
export function parseBuildList(markdown) {
  const items = [];
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // A data row splits into: '', ID, Feature, Phase, Status, Definition of done, ''
    if (cells.length >= 7 && /^[A-Z]{2,4}-\d+$/.test(cells[1])) {
      items.push({ id: cells[1], feature: cells[2], phase: cells[3], status: cells[4], dod: cells[5] });
    }
  }
  return items;
}

/**
 * Turn an item into its git branch name: lowercase ID plus up to four slug words from the
 * feature title, e.g. FND-1 "Expo/React Native app scaffold (TypeScript)"
 * → "fnd-1-expo-react-native-app".
 */
export function branchNameFor(item) {
  const slug = item.feature
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-');
  return `${item.id.toLowerCase()}-${slug}`;
}

/** `next` subcommand — see the file header. Exit codes: 2 = unsafe to run, 3 = list finished. */
function next() {
  const dirty = execSync('git status --porcelain', { cwd: repoRoot }).toString().trim();
  if (dirty) {
    console.error('Refusing to pick an item: the working tree is dirty. Finish or merge the current work first.\n' + dirty);
    process.exit(2);
  }
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot }).toString().trim();
  if (branch !== 'main') {
    console.error(`Refusing to pick an item: on branch "${branch}", not main. Merge or switch first.`);
    process.exit(2);
  }
  const buildList = readFileSync(path.join(repoRoot, 'docs', 'BUILD_LIST.md'), 'utf8');
  const item = parseBuildList(buildList).find((i) => i.status === 'Not started');
  if (!item) {
    console.error('No `Not started` items remain in docs/BUILD_LIST.md. The board has nothing to do.');
    process.exit(3);
  }
  const state = { ...item, branch: branchNameFor(item), pickedAt: new Date().toISOString() };
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  console.log(JSON.stringify(state));
}

/** `prompt <planner|builder>` subcommand — fills the role's template with the saved item. */
function prompt(role) {
  if (role !== 'planner' && role !== 'builder') {
    console.error(`Unknown prompt role "${role}" — expected planner or builder.`);
    process.exit(1);
  }
  // Strip a UTF-8 BOM in case the state file was ever hand-edited in an editor that adds one.
  const state = JSON.parse(readFileSync(stateFile, 'utf8').replace(/^﻿/, ''));
  const template = readFileSync(path.join(repoRoot, 'automation', 'prompts', `${role}.md`), 'utf8');
  process.stdout.write(template.replaceAll('{{ITEM_JSON}}', JSON.stringify(state, null, 2)));
}

/** `check` subcommand — self-tests on a synthetic build list; prints PASS/FAIL per assertion. */
function check() {
  const fixture = [
    '# Fixture',
    '| ID | Feature | Phase | Status | Definition of done |',
    '|---|---|---|---|---|',
    '| FND-1 | Expo/React Native app scaffold (TypeScript) | P0 | Done | Builds on both platforms |',
    '| LOG-2 | Add exercises, log sets with reps and weight | P0 | Not started | Session reopens intact |',
    '| TK-10 | Rest timer | P1 | Not started | Timer survives backgrounding |',
    'Some prose that | contains | pipes but is not a row.',
  ].join('\n');

  let failures = 0;
  const assert = (name, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (!cond) failures++;
  };

  const items = parseBuildList(fixture);
  assert('parses exactly the three feature rows', items.length === 3);
  assert('keeps document order', items[0]?.id === 'FND-1' && items[2]?.id === 'TK-10');
  assert('reads all five columns', items[1]?.phase === 'P0' && items[1]?.status === 'Not started' && items[1]?.dod === 'Session reopens intact');
  assert('first Not started is LOG-2, not Done FND-1', items.find((i) => i.status === 'Not started')?.id === 'LOG-2');
  assert('branch name is kebab id + 4 slug words', branchNameFor(items[0]) === 'fnd-1-expo-react-native-app');
  assert('branch name survives short titles', branchNameFor(items[2]) === 'tk-10-rest-timer');

  for (const role of ['planner', 'builder']) {
    let tpl = '';
    try {
      tpl = readFileSync(path.join(repoRoot, 'automation', 'prompts', `${role}.md`), 'utf8');
    } catch {
      /* missing file fails the next assertion */
    }
    assert(`${role}.md template exists and has the {{ITEM_JSON}} placeholder`, tpl.includes('{{ITEM_JSON}}'));
  }

  console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'next') next();
else if (cmd === 'prompt') prompt(arg);
else if (cmd === 'check') check();
else {
  console.error('Usage: node automation/scripts/pipeline.mjs <next | prompt planner|builder | check>');
  process.exit(1);
}
