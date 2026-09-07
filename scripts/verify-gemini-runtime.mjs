import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const target = process.argv[2] || `${process.platform}-${process.arch}`;
const [platform] = target.split('-');
const executable = path.join(projectRoot, 'runtime', target, platform === 'win32' ? 'gemini.exe' : 'gemini');
const manifestPath = path.join(projectRoot, 'runtime', target, 'manifest.json');

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const env = { ...process.env };
if (platform === 'win32') {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  env.PATH = [path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter);
} else {
  env.PATH = '/usr/bin:/bin';
}

delete env.GEMINI_PATH;
const result = spawnSync(executable, ['--version'], {
  cwd: projectRoot,
  env,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30000
});
if (result.status !== 0) {
  throw new Error(`Runtime version check failed (${result.status}):\n${result.stderr || result.stdout}`);
}
const version = result.stdout.trim();
if (version !== manifest.geminiCliVersion) {
  throw new Error(`Runtime version mismatch: expected ${manifest.geminiCliVersion}, got ${version}`);
}
console.log(`OK ${target} Gemini CLI ${version}`);
console.log(`Executable: ${executable}`);
console.log(`Node runtime: ${manifest.nodeVersion}`);
console.log(`Payload: ${manifest.payload.files} files, ${manifest.payload.bytes} bytes`);
