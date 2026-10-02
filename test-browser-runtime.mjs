import assert from 'node:assert/strict';
import { resolveBraveExecutablePath } from './scripts/browser-runtime.mjs';

const programFiles = 'C:\\Program Files';
const expectedBrave = `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`;
const foundBrave = resolveBraveExecutablePath({
  platform: 'win32',
  env: { ProgramFiles: programFiles, 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' },
  exists: (candidate) => candidate === expectedBrave,
});
assert.equal(foundBrave, expectedBrave, 'Windows defaults to Brave when it is installed');

const explicitBrave = 'D:\\Browser\\Brave\\brave.exe';
assert.equal(resolveBraveExecutablePath({ platform: 'win32', env: { BRAVE_EXECUTABLE_PATH: explicitBrave }, exists: (candidate) => candidate === explicitBrave }), explicitBrave);
assert.throws(
  () => resolveBraveExecutablePath({ platform: 'win32', env: { BRAVE_EXECUTABLE_PATH: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' }, exists: () => true }),
  /Refusing to launch Microsoft Edge/,
  'an explicit Edge path is rejected',
);
assert.throws(
  () => resolveBraveExecutablePath({ platform: 'win32', env: { CI: 'false' }, exists: () => false }),
  /Brave was not found/,
  'local browser checks do not silently fall back to another browser',
);
assert.equal(resolveBraveExecutablePath({ platform: 'linux', env: { CI: 'true' }, exists: () => false }), undefined,
  'CI without Brave uses Playwright-managed Chromium');

console.log('Brave browser selection checks passed');

