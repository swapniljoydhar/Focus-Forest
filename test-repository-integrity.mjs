import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.version, packageJson.version, 'manifest and package versions must stay aligned');
assert.ok(manifest.permissions.includes('storage'), 'Chromium storage APIs require the storage permission');
assert.equal(manifest.permissions.includes('storage.sync'), false, 'storage.sync is an API, not a manifest permission');
const required = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.chrome_url_overrides?.newtab,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap((script) => script.js || [])
].filter(Boolean);

for (const relativePath of required) {
  assert.ok(fs.existsSync(path.join(root, relativePath)), `manifest path must exist: ${relativePath}`);
}

const htmlFiles = [];
const sourceFiles = [];
function walk(directory) {
  for (const name of fs.readdirSync(directory)) {
    if (name.startsWith('.') || ['node_modules', 'coverage', 'test-results', 'playwright-report'].includes(name)) continue;
    const fullPath = path.join(directory, name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath);
    else if (name.endsWith('.html')) htmlFiles.push(fullPath);
    else if (/\.(?:js|html|css)$/.test(name)) sourceFiles.push(fullPath);
  }
}
walk(root);

for (const filePath of htmlFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const reference = match[1];
    assert.doesNotMatch(reference, /^(?:https?:|data:|javascript:|\/\/)/i, `${path.relative(root, filePath)} must not load an external resource: ${reference}`);
    if (/^(?:\.|[^#].*\.(?:js|css|png|svg|ico|webp|jpg|jpeg))$/i.test(reference) && !reference.startsWith('#')) {
      const cleanReference = reference.split(/[?#]/, 1)[0];
      assert.ok(fs.existsSync(path.resolve(path.dirname(filePath), cleanReference)), `HTML asset must exist: ${path.relative(root, filePath)} -> ${reference}`);
    }
  }
}

for (const filePath of sourceFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  if (process.platform !== 'win32') {
    assert.doesNotMatch(source, /\r/, `${path.relative(root, filePath)} must use LF line endings`);
  }
  const withoutSvgNamespace = source.replaceAll('http://www.w3.org/2000/svg', '');
  assert.doesNotMatch(withoutSvgNamespace, /https?:\/\//i, `${path.relative(root, filePath)} must not contain a runtime external URL`);
}

console.log(`repository integrity passed: ${htmlFiles.length} HTML files, ${sourceFiles.length} source/config files, ${required.length} manifest references`);
