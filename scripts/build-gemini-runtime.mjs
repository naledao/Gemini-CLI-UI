import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POSTJECT_VERSION = '1.0.0-alpha.6';
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const RUNTIME_SCHEMA_VERSION = 1;

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptDir, '..');
const target = process.argv[2] || `${process.platform}-${process.arch}`;
const [targetPlatform, targetArch] = target.split('-');

if (!targetPlatform || !targetArch) {
  throw new Error(`Invalid runtime target: ${target}`);
}
if (targetPlatform !== process.platform || targetArch !== process.arch) {
  throw new Error(`This builder currently requires a native ${target} host. Current host is ${process.platform}-${process.arch}.`);
}

const exeName = targetPlatform === 'win32' ? 'gemini.exe' : 'gemini';
const runtimeDir = path.join(projectRoot, 'runtime', target);
const appDir = path.join(runtimeDir, 'app', 'gemini-cli');
const buildDir = path.join(projectRoot, '.runtime-build', target);
const toolsDir = path.join(projectRoot, '.runtime-tools');

function nodeMajor(version = process.versions.node) {
  return Number(String(version).split('.')[0]);
}

function getNodeVersion(executable) {
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) return null;
  return result.stdout?.trim().replace(/^v/, '') || null;
}

async function findNode22() {
  const executableName = targetPlatform === 'win32' ? 'node.exe' : 'node';
  const candidates = [];
  if (process.env.GEMINI_RUNTIME_NODE?.trim()) {
    candidates.push(path.resolve(process.env.GEMINI_RUNTIME_NODE.trim().replace(/^"|"$/g, '')));
  }
  candidates.push(path.join(projectRoot, '.runtime-node', target, executableName));

  // Developer convenience on Windows: portable Node archives are commonly
  // unpacked under %LOCALAPPDATA%\Temp. This keeps machine-specific paths out
  // of the repository while still making local builds one command.
  if (targetPlatform === 'win32' && process.env.LOCALAPPDATA) {
    const tempRoot = path.join(process.env.LOCALAPPDATA, 'Temp');
    try {
      const entries = await fs.readdir(tempRoot, { withFileTypes: true });
      const matching = entries
        .filter((entry) => entry.isDirectory() && /^node-v22\..*-win-x64$/i.test(entry.name))
        .map((entry) => path.join(tempRoot, entry.name, 'node.exe'))
        .sort()
        .reverse();
      candidates.push(...matching);
    } catch {
      // The temp directory is only a convenience lookup.
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    if (!(await exists(candidate))) continue;
    const version = getNodeVersion(candidate);
    if (version && nodeMajor(version) === 22) {
      return { executable: candidate, version };
    }
  }
  return null;
}

if (nodeMajor() !== 22) {
  if (process.env.GEMINI_RUNTIME_BUILD_REEXEC === '1') {
    throw new Error(`Gemini runtime build requires Node 22, but re-executed with ${process.version}.`);
  }
  const node22 = await findNode22();
  if (!node22) {
    throw new Error(
      `Gemini runtime build requires Node 22 (current: ${process.version}). ` +
      'Install/provide Node 22 or set GEMINI_RUNTIME_NODE to a Node 22 executable.'
    );
  }
  console.log(`[runtime] Re-launching builder with Node v${node22.version}: ${node22.executable}`);
  const child = spawnSync(node22.executable, [scriptPath, target], {
    cwd: projectRoot,
    env: { ...process.env, GEMINI_RUNTIME_BUILD_REEXEC: '1' },
    stdio: 'inherit',
    windowsHide: true
  });
  process.exit(child.status ?? 1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr, result.error?.stack || result.error?.message].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}${output ? `\n${output}` : ''}`);
  }
  return result.stdout?.trim() || '';
}

function runNpm(args, options = {}) {
  // npm scripts expose the real npm-cli.js path. Prefer it so Windows never
  // needs to spawn the npm.cmd shim directly (which can fail with EINVAL).
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && /\.m?js$/i.test(npmExecPath)) {
    return run(process.execPath, [npmExecPath, ...args], options);
  }
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    return run(comspec, ['/d', '/s', '/c', 'npm', ...args], options);
  }
  return run('npm', args, options);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

async function dirStats(root) {
  let files = 0;
  let bytes = 0;
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        files += 1;
        bytes += stat.size;
      }
    }
  }
  await walk(root);
  return { files, bytes };
}

function defaultGeminiSource() {
  if (process.env.GEMINI_CLI_SOURCE?.trim()) {
    return path.resolve(process.env.GEMINI_CLI_SOURCE.trim());
  }
  const appData = process.env.APPDATA;
  if (appData) {
    return path.join(appData, 'npm', 'node_modules', '@google', 'gemini-cli');
  }
  return null;
}

function locateGlobalGeminiFallback() {
  try {
    const root = runNpm(['root', '-g']);
    return path.join(root, '@google', 'gemini-cli');
  } catch {
    return null;
  }
}

async function ensurePostject() {
  const cli = path.join(toolsDir, 'node_modules', 'postject', 'dist', 'cli.js');
  if (await exists(cli)) return cli;

  await fs.mkdir(toolsDir, { recursive: true });
  console.log(`[runtime] Installing build-only postject@${POSTJECT_VERSION} into ${toolsDir}`);
  runNpm(['install', '--prefix', toolsDir, '--no-save', '--ignore-scripts', `postject@${POSTJECT_VERSION}`], {
    env: process.env,
    stdio: 'inherit'
  });
  if (!(await exists(cli))) {
    throw new Error(`postject installation completed but ${cli} was not found`);
  }
  return cli;
}

let sourceRoot = defaultGeminiSource();
if (!sourceRoot || !(await exists(path.join(sourceRoot, 'package.json')))) {
  sourceRoot = locateGlobalGeminiFallback();
}
if (!sourceRoot || !(await exists(path.join(sourceRoot, 'package.json')))) {
  throw new Error('Unable to locate the globally installed @google/gemini-cli. Set GEMINI_CLI_SOURCE to its package directory.');
}

const sourcePackage = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
const entryRelative = typeof sourcePackage.bin === 'string'
  ? sourcePackage.bin
  : sourcePackage.bin?.gemini || 'bundle/gemini.js';
const sourceEntry = path.join(sourceRoot, entryRelative);
if (!(await exists(sourceEntry))) {
  throw new Error(`Gemini CLI entry does not exist: ${sourceEntry}`);
}

console.log(`[runtime] Source: ${sourceRoot}`);
console.log(`[runtime] Gemini CLI: ${sourcePackage.version}`);
console.log(`[runtime] Target: ${target}`);

await fs.rm(runtimeDir, { recursive: true, force: true });
await fs.rm(buildDir, { recursive: true, force: true });
await fs.mkdir(appDir, { recursive: true });
await fs.mkdir(buildDir, { recursive: true });

await fs.cp(sourceRoot, appDir, {
  recursive: true,
  force: true,
  filter: (src) => {
    const name = path.basename(src);
    if (/\.bak(?:-|$)/i.test(name)) return false;
    if (name === '.git') return false;
    return true;
  }
});

const copiedEntry = path.join(appDir, entryRelative);
const bundleFiles = await fs.readdir(path.join(appDir, 'bundle')).catch(() => []);
let resumeFixDetected = false;
for (const name of bundleFiles) {
  if (!name.endsWith('.js')) continue;
  const full = path.join(appDir, 'bundle', name);
  const text = await fs.readFile(full, 'utf8').catch(() => '');
  if (text.includes('explicitFunctionResponseIds') && text.includes('emittedFunctionResponseIds')) {
    resumeFixDetected = true;
    break;
  }
}
if (!resumeFixDetected) {
  console.warn('[runtime] Warning: local functionResponse resume-fix marker was not detected in copied bundle.');
}

const launcherPath = path.join(buildDir, 'launcher.cjs');
const launcher = `const path = require('node:path');\nconst { pathToFileURL } = require('node:url');\n\n// The staged ESM entry is external to the SEA blob, so keep the CLI in this\n// process instead of using Gemini's standard-SEA relaunch argv convention.\nprocess.env.GEMINI_CLI_NO_RELAUNCH = '1';\n\nconst runtimeDir = path.dirname(process.execPath);\nconst entry = path.join(runtimeDir, 'app', 'gemini-cli', ${JSON.stringify(entryRelative.split('/').join(path.sep))});\nlet forwarded = process.argv.slice(1);\nif (forwarded.length > 0) {\n  try {\n    if (path.resolve(forwarded[0]) === path.resolve(process.execPath)) forwarded = forwarded.slice(1);\n  } catch {}\n}\nprocess.argv = [process.execPath, entry, ...forwarded];\n\nimport(pathToFileURL(entry).href).catch((error) => {\n  process.stderr.write((error && error.stack ? error.stack : String(error)) + '\\n');\n  process.exitCode = 1;\n});\n`;
await fs.writeFile(launcherPath, launcher, 'utf8');

const seaBlob = path.join(buildDir, 'sea-prep.blob');
const seaConfigPath = path.join(buildDir, 'sea-config.json');
await fs.writeFile(seaConfigPath, JSON.stringify({
  main: launcherPath,
  output: seaBlob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false
}, null, 2));

run(process.execPath, ['--experimental-sea-config', seaConfigPath], { stdio: 'inherit' });

const outputExe = path.join(runtimeDir, exeName);
await fs.copyFile(process.execPath, outputExe);

const postjectCli = await ensurePostject();
run(process.execPath, [postjectCli, outputExe, 'NODE_SEA_BLOB', seaBlob, '--sentinel-fuse', SEA_FUSE], { stdio: 'inherit' });

const payloadStats = await dirStats(appDir);
const manifest = {
  schemaVersion: RUNTIME_SCHEMA_VERSION,
  runtimeId: target,
  platform: targetPlatform,
  arch: targetArch,
  executable: exeName,
  geminiCliVersion: sourcePackage.version,
  nodeVersion: process.version,
  entry: path.posix.join('app', 'gemini-cli', entryRelative.split(path.sep).join('/')),
  sourcePackage: sourceRoot,
  builtAt: new Date().toISOString(),
  localResumeFixDetected: resumeFixDetected,
  geminiInternalRelaunch: false,
  payload: payloadStats,
  sha256: {
    executable: await sha256(outputExe),
    geminiEntry: await sha256(copiedEntry)
  }
};
await fs.writeFile(path.join(runtimeDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`[runtime] Built ${outputExe}`);
console.log(`[runtime] Payload ${payloadStats.files} files, ${(payloadStats.bytes / 1024 / 1024).toFixed(1)} MiB`);
console.log(`[runtime] SEA Node ${process.version}; Gemini CLI ${sourcePackage.version}`);
