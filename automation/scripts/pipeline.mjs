#!/usr/bin/env node
/**
 * Astra pipeline helper — the deterministic glue between n8n and the headless Claude runs.
 * See docs/PIPELINE.md for the whole picture.
 *
 * The build list (docs/BUILD_LIST.md) has two kinds of table:
 *   - FEATURE tables: one row per PRD feature (FND-1, LOG-2, …) with its status and definition
 *     of done. These are the product truth.
 *   - The BUILD ORDER table (under "## Build order"): one row per STEP (B01, B02, …). A step is
 *     one planner run + one builder run on one branch, and may cover several features or part of
 *     one. This is the queue the pipeline works through, in row order.
 *
 * Subcommands:
 *   next [--dry-run]  Pick the next eligible step: the first `Not started` step whose every
 *                     `Depends on` step is `Built` or `Done`. `Blocked` steps and steps with
 *                     unmet dependencies are skipped. Saves the pick to
 *                     automation/state/current-item.json and prints it as JSON, with each
 *                     covered feature's title, phase and definition of done joined in.
 *                     Refuses (exit 2) when the list fails lint, when any step is `In progress`,
 *                     when the working tree is dirty or not on main, or when the picked step's
 *                     branch already exists — each is a sign something is mid-flight, and the
 *                     pipeline is strictly one step at a time. `--dry-run` parses and prints the
 *                     pick without touching git or writing state (for previewing the queue).
 *   lint              Validate the build list: every Covers ID exists as a feature, every
 *                     unfinished feature is covered by some step (or listed under "Not steps"),
 *                     dependencies point at earlier existing steps, statuses are known, branches
 *                     are unique. Exit 1 on errors.
 *   prompt <role>     Fill the planner or builder prompt template with the saved pick and print
 *                     it. The run-*.cmd wrappers pipe this into `claude -p`.
 *   check             Self-tests on synthetic data (no git, no file writes). Exits non-zero on
 *                     any failure. Substitutes for Jest — this is tooling outside the app.
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
const buildListFile = path.join(repoRoot, 'docs', 'BUILD_LIST.md');

/** A feature row's ID looks like FND-1 or LOG-12; a step's like B05. */
const FEATURE_ID = /^[A-Z]{2,4}-\d+$/;
const FEATURE_ID_ANYWHERE = /[A-Z]{2,4}-\d+/g;
const STEP_ID = /^B\d{2,3}$/;
const STEP_ID_ANYWHERE = /B\d{2,3}/g;

/** The statuses a feature row may carry, and the step set (the same plus `Blocked`). */
const FEATURE_STATUSES = new Set(['Not started', 'In progress', 'Built', 'Done']);
const STEP_STATUSES = new Set([...FEATURE_STATUSES, 'Blocked']);
/** Statuses that satisfy a dependency: the step's code is on main. */
const SATISFIED = new Set(['Built', 'Done']);

/** Split a Markdown table line into trimmed cells. Returns null for non-table lines. */
function cells(line) {
  if (!line.trimStart().startsWith('|')) return null;
  return line.split('|').map((c) => c.trim());
}

/**
 * Split the build-list Markdown at the "## Build order" heading.
 * Returns { features: markdown-before, order: markdown-of-that-section } so the two parsers
 * never see each other's rows (a step row has a feature-looking ID in its Covers cell).
 */
export function splitSections(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^##\s+Build order\s*$/.test(l));
  if (start === -1) return { features: markdown, order: '' };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return {
    features: lines.slice(0, start).concat(lines.slice(end)).join('\n'),
    order: lines.slice(start, end).join('\n'),
  };
}

/**
 * Pull every feature row out of the feature tables.
 * A feature row's cells are: '', ID, Feature, Phase, Status, Definition of done, ''.
 * Returns [{id, feature, phase, status, dod}] in document order.
 */
export function parseFeatures(markdown) {
  const items = [];
  for (const line of splitSections(markdown).features.split('\n')) {
    const c = cells(line);
    if (c && c.length >= 7 && FEATURE_ID.test(c[1])) {
      items.push({ id: c[1], feature: c[2], phase: c[3], status: c[4], dod: c[5] });
    }
  }
  return items;
}

/**
 * Pull every step row out of the Build order table.
 * A step row's cells are: '', Step, Title, Covers, Branch, Status, Depends on, Scope, ''.
 * `covers` keeps each feature ID and whether the row marked it "(part)"; `dependsOn` is the
 * list of step IDs (an em dash or blank means none). Returns steps in row order = build order.
 */
export function parseSteps(markdown) {
  const steps = [];
  for (const line of splitSections(markdown).order.split('\n')) {
    const c = cells(line);
    if (!(c && c.length >= 9 && STEP_ID.test(c[1]))) continue;
    const covers = [];
    // Each covered feature is "ID" or "ID (part)"; notes may follow in the same cell.
    for (const token of c[3].split(',')) {
      const m = token.match(FEATURE_ID_ANYWHERE);
      if (m) covers.push({ id: m[0], partial: /\(part\b/.test(token) });
    }
    steps.push({
      id: c[1],
      title: c[2],
      covers,
      branch: c[4],
      status: c[5],
      dependsOn: c[6].match(STEP_ID_ANYWHERE) ?? [],
      scope: c[7],
    });
  }
  return steps;
}

/** Feature IDs the "Not steps:" line exempts from the must-be-covered rule (e.g. NFR-11). */
export function parseNotSteps(markdown) {
  const line = splitSections(markdown)
    .order.split('\n')
    .find((l) => l.startsWith('**Not steps:**'));
  return line ? (line.match(FEATURE_ID_ANYWHERE) ?? []) : [];
}

/**
 * Parse the whole build list once: the feature rows, the step rows, the "Not steps" exemptions,
 * and lookup maps by id. Everything downstream (lint, pick) starts from this one object.
 */
export function parseBuildList(markdown) {
  const features = parseFeatures(markdown);
  const steps = parseSteps(markdown);
  return {
    features,
    steps,
    notSteps: parseNotSteps(markdown),
    featureById: new Map(features.map((f) => [f.id, f])),
    stepById: new Map(steps.map((s) => [s.id, s])),
  };
}

/**
 * Validate the build list. Returns { errors, warnings } as arrays of plain sentences.
 * Errors mean the pipeline must not pick from this list; warnings are for Tristen to read.
 */
export function lintBuildList(markdown) {
  const errors = [];
  const warnings = [];
  const { features, steps, notSteps, featureById } = parseBuildList(markdown);
  const exempt = new Set(notSteps);

  if (steps.length === 0) errors.push('No Build order table found (section "## Build order" with B-numbered rows).');

  for (const f of features) {
    if (!FEATURE_STATUSES.has(f.status)) errors.push(`${f.id}: unknown status "${f.status}".`);
  }

  const seenSteps = new Set();
  const seenBranches = new Map();
  const covered = new Set();
  steps.forEach((s, index) => {
    if (seenSteps.has(s.id)) errors.push(`${s.id}: duplicate step id.`);
    seenSteps.add(s.id);
    if (!STEP_STATUSES.has(s.status)) errors.push(`${s.id}: unknown status "${s.status}".`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.branch)) errors.push(`${s.id}: branch "${s.branch}" is not kebab-case.`);
    if (seenBranches.has(s.branch)) errors.push(`${s.id}: branch "${s.branch}" is also used by ${seenBranches.get(s.branch)}.`);
    seenBranches.set(s.branch, s.id);
    if (s.covers.length === 0) errors.push(`${s.id}: covers no feature.`);
    for (const { id } of s.covers) {
      if (!featureById.has(id)) errors.push(`${s.id}: covers unknown feature ${id}.`);
      covered.add(id);
    }
    for (const dep of s.dependsOn) {
      const depIndex = steps.findIndex((o) => o.id === dep);
      if (depIndex === -1) errors.push(`${s.id}: depends on unknown step ${dep}.`);
      else if (depIndex >= index) errors.push(`${s.id}: depends on ${dep}, which is not earlier in the table.`);
    }
    if (SATISFIED.has(s.status)) {
      for (const dep of s.dependsOn) {
        const d = steps.find((o) => o.id === dep);
        if (d && !SATISFIED.has(d.status)) warnings.push(`${s.id} is ${s.status} but its dependency ${dep} is ${d.status}.`);
      }
    }
  });

  for (const f of features) {
    if (f.status !== 'Done' && !covered.has(f.id) && !exempt.has(f.id)) {
      errors.push(`${f.id} is ${f.status} but no step covers it — it can never be built.`);
    }
  }
  return { errors, warnings };
}

/**
 * Choose the next step to run. Returns { pick, skipped, inProgress } where `pick` is the step
 * (joined with its covered features) or null, `skipped` lists [{id, reason}] for every
 * ineligible step before the pick, and `inProgress` lists steps mid-flight (the caller refuses
 * to run while any exist).
 */
export function pickNext(markdown) {
  const { steps, featureById, stepById } = parseBuildList(markdown);
  const inProgress = steps.filter((s) => s.status === 'In progress').map((s) => s.id);
  const skipped = [];
  let pick = null;

  for (const s of steps) {
    if (SATISFIED.has(s.status) || s.status === 'In progress') continue;
    if (s.status === 'Blocked') {
      skipped.push({ id: s.id, reason: 'Blocked' });
      continue;
    }
    const unmet = s.dependsOn.filter((d) => !SATISFIED.has(stepById.get(d)?.status));
    if (unmet.length) {
      skipped.push({ id: s.id, reason: `waiting on ${unmet.join(', ')}` });
      continue;
    }
    pick = {
      id: s.id,
      // Named `feature` (not `title`) because the n8n board's Code nodes already read
      // item.feature; the step title is what they should show there.
      feature: s.title,
      branch: s.branch,
      status: s.status,
      // Phase of the step = phase of its first covered feature (steps are phase-homogeneous
      // except for the small pulled-forward riders the row itself explains).
      phase: featureById.get(s.covers[0]?.id)?.phase ?? '',
      dependsOn: s.dependsOn,
      covers: s.covers.map(({ id, partial }) => {
        const f = featureById.get(id);
        return { id, partial, feature: f?.feature ?? '', phase: f?.phase ?? '', status: f?.status ?? '', dod: f?.dod ?? '' };
      }),
      scope: s.scope,
    };
    break;
  }
  return { pick, skipped, inProgress };
}

/** True when a local or remote-tracking branch of that name exists. */
function branchExists(branch) {
  const refs = [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`];
  return refs.some((ref) => {
    try {
      execSync(`git show-ref --verify --quiet ${ref}`, { cwd: repoRoot, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
}

/** `lint` subcommand — prints each finding; exit 1 on errors. */
function lint() {
  const { errors, warnings } = lintBuildList(readFileSync(buildListFile, 'utf8'));
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`ERROR ${e}`);
  console.log(errors.length === 0 ? `Build list OK (${warnings.length} warning(s)).` : `${errors.length} error(s).`);
  process.exit(errors.length === 0 ? 0 : 1);
}

/** `next [--dry-run]` subcommand — see the file header. Exit codes: 2 = unsafe, 3 = nothing to do. */
function next(dryRun) {
  const markdown = readFileSync(buildListFile, 'utf8');
  const { errors } = lintBuildList(markdown);
  if (errors.length) {
    console.error('Refusing to pick a step: docs/BUILD_LIST.md fails lint.\n' + errors.map((e) => '  ' + e).join('\n'));
    process.exit(2);
  }
  const { pick, skipped, inProgress } = pickNext(markdown);
  for (const s of skipped) console.error(`skip ${s.id}: ${s.reason}`);
  if (inProgress.length) {
    console.error(`Refusing to pick a step: ${inProgress.join(', ')} is In progress. Finish or merge it first.`);
    process.exit(2);
  }
  if (!pick) {
    console.error('No eligible `Not started` step remains in the Build order. Clear a blocker or merge pending work.');
    process.exit(3);
  }

  if (!dryRun) {
    const dirty = execSync('git status --porcelain', { cwd: repoRoot }).toString().trim();
    if (dirty) {
      console.error('Refusing to pick a step: the working tree is dirty. Finish or merge the current work first.\n' + dirty);
      process.exit(2);
    }
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot }).toString().trim();
    if (branch !== 'main') {
      console.error(`Refusing to pick a step: on branch "${branch}", not main. Merge or switch first.`);
      process.exit(2);
    }
    if (branchExists(pick.branch)) {
      console.error(`Refusing to pick ${pick.id}: branch "${pick.branch}" already exists. Merge it (and flip the step to Built) or delete it.`);
      process.exit(2);
    }
  }

  const state = { ...pick, pickedAt: new Date().toISOString(), dryRun };
  if (!dryRun) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  }
  console.log(JSON.stringify(state));
}

/** `prompt <planner|builder>` subcommand — fills the role's template with the saved pick. */
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
    '## Foundation',
    '| ID | Feature | Phase | Status | Definition of done |',
    '|---|---|---|---|---|',
    '| FND-1 | Expo scaffold | P0 | Built | Builds on both platforms |',
    '| FND-2 | Supabase auth | P0 | In progress | Sign in works |',
    '## Logging',
    '| ID | Feature | Phase | Status | Definition of done |',
    '|---|---|---|---|---|',
    '| LOG-2 | Log sets | P0 | Not started | Session reopens intact |',
    '| LOG-10 | RPE | P1 | Not started | RPE saves |',
    '| NFR-11 | Both platforms | P0 | Not started | Verified on both |',
    'Some prose that | contains | pipes but is not a row.',
    '## Build order',
    '**Not steps:** NFR-11 — device verification.',
    '| Step | Title | Covers | Branch | Status | Depends on | Scope and step definition of done |',
    '|---|---|---|---|---|---|---|',
    '| B01 | UI foundation | FND-1 | ui-foundation | Built | — | Scaffold. |',
    '| B02 | Auth | FND-2 (part) | auth-and-signup | Not started | B01 | Sign in. DoD: works. |',
    '| B03 | Video | LOG-10 (part) | video-service | Blocked | B01 | Waits on provider. |',
    '| B04 | Logger | LOG-2, LOG-10 (part: rides on B04) | logger-screen | Not started | B02, B03 | Log sets. |',
    '## After',
    '| FND-9 | A later feature table row that must still parse | P0 | Done | n/a |',
  ].join('\n');

  let failures = 0;
  const assert = (name, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (!cond) failures++;
  };

  const features = parseFeatures(fixture);
  assert('parses the six feature rows across sections, skipping step rows', features.length === 6 && features.map((f) => f.id).join() === 'FND-1,FND-2,LOG-2,LOG-10,NFR-11,FND-9');
  assert('reads all five feature columns', features[2]?.phase === 'P0' && features[2]?.status === 'Not started' && features[2]?.dod === 'Session reopens intact');

  const steps = parseSteps(fixture);
  assert('parses exactly the four step rows', steps.length === 4 && steps[0]?.id === 'B01' && steps[3]?.id === 'B04');
  assert('reads title, branch, status, scope', steps[1]?.title === 'Auth' && steps[1]?.branch === 'auth-and-signup' && steps[1]?.status === 'Not started' && steps[1]?.scope === 'Sign in. DoD: works.');
  assert('covers keeps ids and (part) flags', steps[3]?.covers.length === 2 && steps[3]?.covers[0].id === 'LOG-2' && steps[3]?.covers[0].partial === false && steps[3]?.covers[1].id === 'LOG-10' && steps[3]?.covers[1].partial === true);
  assert('dependsOn reads multiple ids and treats an em dash as none', steps[0]?.dependsOn.length === 0 && steps[3]?.dependsOn.join() === 'B02,B03');
  assert('Not steps line is read', parseNotSteps(fixture).join() === 'NFR-11');

  const clean = lintBuildList(fixture);
  assert('fixture lints clean', clean.errors.length === 0);

  const broken = fixture
    .replace('| B02 | Auth | FND-2 (part) | auth-and-signup | Not started | B01 |', '| B02 | Auth | FND-2 (part), ZZZ-9 | ui-foundation | Pending | B04 |')
    .replace('**Not steps:** NFR-11 — device verification.', '');
  const bad = lintBuildList(broken).errors;
  assert('lint flags unknown covered feature', bad.some((e) => e.includes('unknown feature ZZZ-9')));
  assert('lint flags duplicate branch', bad.some((e) => e.includes('branch "ui-foundation" is also used by B01')));
  assert('lint flags unknown step status', bad.some((e) => e.includes('B02: unknown status "Pending"')));
  const typoFeature = fixture.replace('| LOG-2 | Log sets | P0 | Not started |', '| LOG-2 | Log sets | P0 | Not Started |');
  assert('lint flags unknown feature status', lintBuildList(typoFeature).errors.some((e) => e.includes('LOG-2: unknown status "Not Started"')));
  assert('lint flags a dependency that is not earlier', bad.some((e) => e.includes('depends on B04, which is not earlier')));
  assert('lint flags an uncovered unfinished feature', bad.some((e) => e.includes('NFR-11 is Not started but no step covers it')));

  const { pick, skipped, inProgress } = pickNext(fixture);
  assert('picks B02: first Not started with deps satisfied', pick?.id === 'B02' && pick?.branch === 'auth-and-signup');
  assert('pick carries n8n keys and joined feature data', pick?.feature === 'Auth' && pick?.phase === 'P0' && pick?.covers[0]?.dod === 'Sign in works' && pick?.covers[0]?.partial === true);
  assert('nothing skipped before the pick, no step in progress', skipped.length === 0 && inProgress.length === 0);

  const afterB02 = fixture.replace('| auth-and-signup | Not started |', '| auth-and-signup | Built |');
  const second = pickNext(afterB02);
  assert('after B02 is Built, B03 is skipped as Blocked and B04 waits on it', second.pick === null && second.skipped.map((s) => `${s.id}:${s.reason}`).join() === 'B03:Blocked,B04:waiting on B03');

  const unblocked = afterB02.replace('| video-service | Blocked |', '| video-service | Built |');
  assert('once B03 is Built, B04 is picked', pickNext(unblocked).pick?.id === 'B04');

  const midFlight = fixture.replace('| auth-and-signup | Not started |', '| auth-and-signup | In progress |');
  assert('an In progress step is reported so next can refuse', pickNext(midFlight).inProgress.join() === 'B02');

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
if (cmd === 'next') next(arg === '--dry-run');
else if (cmd === 'lint') lint();
else if (cmd === 'prompt') prompt(arg);
else if (cmd === 'check') check();
else {
  console.error('Usage: node automation/scripts/pipeline.mjs <next [--dry-run] | lint | prompt planner|builder | check>');
  process.exit(1);
}
