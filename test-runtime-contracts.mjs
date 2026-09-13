import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('.', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const content = read('content/content.js');
const worker = read('background/service-worker.js');

function checkModuleSyntax(relativePath) {
  const source = read(relativePath);
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, `${relativePath} must parse as an ES module:\n${result.stderr}`);
}

checkModuleSyntax('background/service-worker.js');
checkModuleSyntax('content/content.js');

assert.match(content, /function send\s*\(/, 'content script must define its runtime message helper');
assert.match(content, /showChoiceSheet\(depth(?:,\s*current\.node\.confidence)?\)/, 'interruption path must call the defined choice-sheet renderer');
assert.doesNotMatch(content, /showChoiceCard\(depth\)/, 'interruption path must not call the removed showChoiceCard name');
assert.doesNotMatch(content, /\bbackdrop(?:\.|\[)|\bsheetCopy\b/, 'content script must not retain stale choice-sheet variable names');
assert.doesNotMatch(content, /rootEl\.innerHTML/, 'companion markup should be built with DOM APIs rather than an HTML sink');

assert.doesNotMatch(worker, /^# /m, 'service worker must use valid JavaScript comments');
assert.match(worker, /if \(!Object\.hasOwn\(message, key\)\) \{\s*if \(!optional\) return false;/, 'message validation must continue through optional fields without accepting inherited or missing required fields');

console.log('runtime contracts passed');
