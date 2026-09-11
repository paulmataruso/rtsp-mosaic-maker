#!/usr/bin/env node
/**
 * Resolves the license of every PRODUCTION dependency of backend/frontend/shared,
 * transitively, from the installed node_modules tree, and groups them by license.
 * Used to keep THIRD_PARTY_NOTICES.md accurate. Run after `npm install`:
 *
 *   node scripts/check-licenses.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function prodDeps(pkgRelPath) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, pkgRelPath), 'utf8'));
  return Object.keys(pkg.dependencies || {});
}

function resolvePkg(name) {
  const p = path.join(ROOT, 'node_modules', ...name.split('/'), 'package.json');
  if (!fs.existsSync(p)) return null;
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  let license = pkg.license;
  if (!license && Array.isArray(pkg.licenses)) {
    license = pkg.licenses.map((l) => l.type).join(' OR ');
  }
  if (license && typeof license === 'object') license = license.type;
  return { name, version: pkg.version, license: license || 'UNKNOWN', deps: Object.keys(pkg.dependencies || {}) };
}

function collectAll(seedNames) {
  const seen = new Map();
  const queue = [...seedNames];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const info = resolvePkg(name);
    if (!info) {
      seen.set(name, { name, license: 'NOT_FOUND' });
      continue;
    }
    seen.set(name, info);
    for (const dep of info.deps) if (!seen.has(dep)) queue.push(dep);
  }
  return seen;
}

const seed = [
  ...new Set([...prodDeps('backend/package.json'), ...prodDeps('frontend/package.json'), ...prodDeps('shared/package.json')]),
];
const all = collectAll(seed);

const byLicense = {};
for (const [name, info] of all) {
  const key = info.license || 'NOT_FOUND';
  (byLicense[key] ??= []).push(name);
}

const COPYLEFT_RE = /GPL|SSPL|BUSL|Commons Clause|CC-BY-NC|Proprietary/i;
let flagged = 0;

console.log(`Resolved ${all.size} production packages (transitive) across backend/frontend/shared.\n`);
for (const license of Object.keys(byLicense).sort()) {
  const names = byLicense[license].sort();
  const flag = COPYLEFT_RE.test(license) ? '  <-- REVIEW (copyleft/non-permissive)' : '';
  if (flag) flagged += names.length;
  console.log(`${license} (${names.length})${flag}`);
  console.log(`  ${names.join(', ')}\n`);
}

if (flagged > 0) {
  console.error(`\n${flagged} package(s) flagged for manual review before shipping under AGPL.`);
  process.exit(1);
}
console.log('No copyleft/non-permissive licenses found among production dependencies.');
