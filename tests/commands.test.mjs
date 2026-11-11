// Tests for the plugin's slash commands (local files only, no network). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const front = (md) => {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'front matter');
  return Object.fromEntries(m[1].split('\n').map((l) => l.match(/^([a-z-]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]]));
};
// The wording rules of 7Maps owner copy: no em dash, never "official", "certified" or "root", no road or Waze words (tool
// names such as road_conditions are names, not copy), no persuasion or scarcity.
const copyProblems = (t) => {
  const s = t.replace(/`[^`]*`/g, ' ');
  const out = [];
  if (t.includes('—')) out.push('em dash');
  if (/\b(official|officially|certified|root)\b/i.test(s)) out.push('official / certified / root');
  if (/\bwaze\b|\b(roads?|tolls?|detours?|trips?|highways?|lanes?)\b/i.test(s)) out.push('road word');
  if (/\bfree\b/i.test(s)) out.push('"free"');
  if (/\b(hurry|limited|act now|don't miss|last chance|exclusive|boost|rank higher|recommended by)\b/i.test(s)) out.push('persuasion or scarcity');
  return out;
};

test('every command runs only when typed and has a description', () => {
  const files = fs.readdirSync(path.join(root, 'commands')).filter((f) => f.endsWith('.md'));
  assert.deepEqual(files.sort(), ['always.md', 'never.md', 'verify.md']);
  for (const f of files) {
    const fm = front(read('commands/' + f));
    assert.equal(fm['disable-model-invocation'], 'true', `${f}: disable-model-invocation`);
    assert.ok(fm.description && fm.description.length < 200, `${f}: short description`);
  }
});

test('/7maps:verify walks through claim_mcp_server with the claim page as the fallback', () => {
  const md = read('commands/verify.md');
  assert.ok(md.includes('$ARGUMENTS'), 'takes the server address as its argument');
  assert.equal((md.match(/`claim_mcp_server`/g) || []).length >= 3, true, 'names the tool for the first call, the second call and the optional settings');
  assert.ok(/claim_check/.test(md) && /\.well-known\/7maps-verify\.txt/.test(md), 'the proof line, where it goes and the claim_check');
  assert.ok(md.includes('https://7it.co.il/7maps/claim/') && /not available in this session/.test(md), 'the browser claim page when the tool is missing');
  assert.ok(/Do not write it to any file, commit it, or repeat it/.test(md), 'the owner secret is never written or repeated');
  assert.ok(/usual permission prompt/.test(md) && /Do not guess it from this project's config/.test(md), 'writes only through the normal prompt; never guesses the server');
  assert.ok(/Only if the person asks/.test(md), 'note and alerts only on request');
  assert.ok(md.includes('https://7it.co.il/7maps/claim/#commits') && /does not change how the server is measured or ranked/.test(md), 'what verifying commits to; ranking unaffected');
  assert.ok(!/recover_check|recover: true/.test(md), 'no recovery arguments (the plugin set has none; the claim page has the step)');
  assert.deepEqual(copyProblems(md), [], 'wording rules');
});

test('the skill and README name the verify command; wording rules on the changed lines', () => {
  const skill = read('skills/mcp-preflight/SKILL.md'), readme = read('README.md');
  const line = skill.split('\n').find((l) => l.includes('claim_mcp_server'));
  assert.ok(line && /asks to verify it/.test(line) && line.includes('/7maps:verify'), 'skill: claim_mcp_server only when the person asks to verify their own server');
  assert.deepEqual(copyProblems(line), [], 'skill line wording');
  const r = readme.split('\n').filter((l) => l.includes('/7maps:verify'));
  assert.ok(r.length >= 3, 'README: the tools list, the plugin contents and the command paragraph');
  for (const l of r) assert.deepEqual(copyProblems(l), [], `README wording: ${l.slice(0, 60)}`);
});
