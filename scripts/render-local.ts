// Render a config locally with the same image the Void Sandbox uses.
//   node scripts/render-local.ts <config.json> <outDir> [--no-build] [--platform linux/amd64]
//
// 1. bundles container/dist (esbuild), 2. builds Dockerfile.sandbox unless the image is up to date
// (inputs hash stored as an image label), 3. `docker run --network none` the entry, 4. prints result.json.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer, DIST_DIR } from './build-container.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = join(ROOT, 'Dockerfile.sandbox');
const HASH_LABEL = 'dcs.inputs-hash';

export function imageTag(platform: string | null): string {
  return platform ? `dcs-sandbox:local-${platform.split('/').pop()}` : 'dcs-sandbox:local';
}

export function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', timeout: 15_000 });
  return r.status === 0;
}

function runInherit(argv: string[]): Promise<number> {
  return new Promise((res, rej) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', shell: false });
    child.on('error', rej);
    child.on('close', (code) => res(code ?? 1));
  });
}

async function inputsHash(platform: string | null): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(DOCKERFILE));
  hash.update(platform ?? 'native');
  for (const name of (await readdir(DIST_DIR)).sort()) {
    hash.update(name);
    hash.update(await readFile(join(DIST_DIR, name)));
  }
  return hash.digest('hex').slice(0, 32);
}

function currentImageHash(tag: string): string | null {
  const r = spawnSync('docker', ['image', 'inspect', '--format', `{{index .Config.Labels "${HASH_LABEL}"}}`, tag], {
    encoding: 'utf8',
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

export interface EnsureImageOptions {
  noBuild?: boolean;
  platform?: string | null;
  quiet?: boolean;
}

/** Bundle container/dist and (re)build the image when its inputs changed. Returns the image tag. */
export async function ensureImage(options: EnsureImageOptions = {}): Promise<string> {
  const platform = options.platform ?? null;
  const tag = imageTag(platform);
  if (options.noBuild) return tag;

  await buildContainer({ quiet: options.quiet });
  const hash = await inputsHash(platform);
  if (currentImageHash(tag) === hash) {
    if (!options.quiet) console.log(`image ${tag} is up to date (${hash})`);
    return tag;
  }
  const argv = ['docker', 'build', '-f', DOCKERFILE, '-t', tag, '--label', `${HASH_LABEL}=${hash}`];
  if (platform) argv.push('--platform', platform);
  if (options.quiet) argv.push('--quiet');
  argv.push(ROOT);
  const code = await runInherit(argv);
  if (code !== 0) throw new Error(`docker build failed (exit ${code})`);
  return tag;
}

export interface RenderInDockerOptions {
  configPath: string;
  outDir: string;
  image: string;
  platform?: string | null;
  /** Extra args for render-entry, e.g. ['--stills', '0,47']. */
  entryArgs?: string[];
}

/** `docker run --network none` the render entry. Resolves with the container exit code. */
export async function renderInDocker(options: RenderInDockerOptions): Promise<number> {
  const config = resolve(options.configPath);
  const out = resolve(options.outDir);
  await mkdir(out, { recursive: true });
  const argv = ['docker', 'run', '--rm', '--network', 'none'];
  if (options.platform) argv.push('--platform', options.platform);
  argv.push(
    '-v', `${config}:/work/config.json:ro`,
    '-v', `${out}:/work/out`,
    options.image,
    'node', '/app/render-entry.mjs', '--config', '/work/config.json', '--out', '/work/out',
    ...(options.entryArgs ?? []),
  );
  return runInherit(argv);
}

function formatBytes(n: number): string {
  return n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${(n / 1024).toFixed(1)} KiB`;
}

async function main(argv: string[]): Promise<number> {
  const positional: string[] = [];
  let noBuild = false;
  let platform: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-build') noBuild = true;
    else if (argv[i] === '--platform') platform = argv[++i] ?? null;
    else positional.push(argv[i]);
  }
  const [configPath, outDir] = positional;
  if (!configPath || !outDir) {
    console.error('usage: node scripts/render-local.ts <config.json> <outDir> [--no-build] [--platform linux/amd64]');
    return 2;
  }

  const image = await ensureImage({ noBuild, platform });
  const started = Date.now();
  const code = await renderInDocker({ configPath, outDir, image, platform });
  const wallSeconds = (Date.now() - started) / 1000;

  try {
    const result = JSON.parse(await readFile(join(resolve(outDir), 'result.json'), 'utf8'));
    if (result.ok) {
      console.log(`ok: ${result.totalFrames} frames in ${wallSeconds.toFixed(1)}s (docker run wall time)`);
      console.log(`  preview.mp4     ${formatBytes(result.mp4.bytes)}  ${result.mp4.codec} ${result.mp4.pixFmt} ${result.mp4.width}x${result.mp4.height} ${result.mp4.fps}fps ${result.mp4.durationSeconds}s`);
      console.log(`  transparent.mov ${formatBytes(result.mov.bytes)}  ${result.mov.codec} ${result.mov.profile} ${result.mov.pixFmt}`);
      console.log(`  checks: ${result.verification.checks.length} passed; timings ${JSON.stringify(result.timings)}`);
    } else {
      console.error(`failed: ${result.errorCode} ${result.message}`);
      for (const c of result.verification?.checks ?? []) if (!c.ok) console.error(`  FAIL ${c.name}: ${c.detail}`);
    }
  } catch {
    console.error(`no readable result.json in ${outDir}`);
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
