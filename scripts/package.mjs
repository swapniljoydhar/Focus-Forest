import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = `${root}/dist`;
const archive = `${dist}/focus-forest.zip`;
const entries = ['manifest.json', 'background', 'content', 'dashboard', 'icons', 'newtab', 'popup', 'settings', 'shared'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const command = process.platform === 'win32'
  ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path ${entries.join(',')} -DestinationPath '${archive}' -Force`]]
  : ['zip', ['-rq', archive, ...entries]];
const result = spawnSync(command[0], command[1], { cwd: root, stdio: 'inherit', shell: false });

if (result.error) throw result.error;
if (result.status !== 0 || !existsSync(archive)) {
  throw new Error(`Packaging failed with exit code ${result.status ?? 'unknown'}`);
}

console.log(`Packaged ${archive}`);
