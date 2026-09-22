/**
 * Packages the extension into dist/focus-forest.zip.
 *
 * Archiver selection is capability-probed, never assumed. `zip` is absent on
 * minimal images and often cannot be installed (no root), so a hard dependency
 * on it breaks the build outside CI. Each candidate is attempted in order and a
 * missing binary (spawnSync -> result.error ENOENT) falls through to the next;
 * the error names every candidate tried so an unsupported host is
 * diagnosable in one read.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = `${root}/dist`;
const archive = `${dist}/focus-forest.zip`;
const entries = ['manifest.json', 'background', 'content', 'dashboard', 'icons', 'newtab', 'popup', 'settings', 'shared'];

// Preference order. Both Unix candidates store paths relative to `root` and
// recurse into directories, so the produced archive is identical either way.
const ARCHIVERS = process.platform === 'win32'
  ? [{ name: 'powershell', file: 'powershell.exe', args: () => ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path ${entries.join(',')} -DestinationPath '${archive}' -Force`] }]
  : [
      { name: 'zip', file: 'zip', args: () => ['-rq', archive, ...entries] },
      { name: 'python3 zipfile', file: 'python3', args: () => ['-m', 'zipfile', '-c', archive, ...entries] }
    ];

/** Runs the first archiver this host can actually spawn. */
function runArchiver() {
  const failures = [];
  for (const candidate of ARCHIVERS) {
    const result = spawnSync(candidate.file, candidate.args(), { cwd: root, stdio: 'inherit', shell: false });
    // A missing binary surfaces as result.error (ENOENT); that is the "platform
    // capability absent" signal, so fall through rather than assuming it exists.
    if (result.error) { failures.push(`${candidate.name}: ${result.error.code}`); continue; }
    if (result.status !== 0 || !existsSync(archive)) { failures.push(`${candidate.name}: exit ${result.status ?? 'unknown'}`); continue; }
    return candidate.name;
  }
  throw new Error(`Packaging failed - no usable archiver. Tried ${failures.join('; ')}. Install 'zip', or python3 with the zipfile module.`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const used = runArchiver();
console.log(`Packaged ${archive} (via ${used})`);
