import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const windowsBravePaths = (env) => {
  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData', 'Local');
  return [
    path.win32.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.win32.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.win32.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ];
};

const bravePaths = (platform, env) => {
  if (platform === 'win32') return windowsBravePaths(env);
  if (platform === 'darwin') {
    return [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      path.join(os.homedir(), 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
    ];
  }
  return ['/usr/bin/brave-browser', '/usr/bin/brave-browser-stable', '/usr/bin/brave', '/snap/bin/brave', '/opt/brave.com/brave/brave'];
};

/**
 * Choose Brave for local browser checks. CI runners without Brave use the
 * Playwright-managed Chromium build; local machines fail clearly rather than
 * silently selecting Edge or Chrome.
 */
export function resolveBraveExecutablePath({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const requested = env.BRAVE_EXECUTABLE_PATH;
  if (requested) {
    const normalized = requested.replaceAll('\\', '/').toLowerCase();
    if (normalized.includes('/microsoft/edge/') || /(^|\/)msedge(?:\.exe)?$/.test(normalized)) {
      throw new Error('Refusing to launch Microsoft Edge for Intent Grove browser tests. Set BRAVE_EXECUTABLE_PATH to Brave.');
    }
    if (!exists(requested)) throw new Error(`Brave executable does not exist: ${requested}`);
    return requested;
  }

  const found = bravePaths(platform, env).find((candidate) => exists(candidate));
  if (found) return found;
  if (env.CI === 'true' || env.CI === '1') return undefined;
  throw new Error('Brave was not found. Install Brave or set BRAVE_EXECUTABLE_PATH; tests will not silently use another browser.');
}

