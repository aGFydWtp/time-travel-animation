// ジョブ専用 Sandbox の操作と R2 への保存（Void API を使う唯一の場所）。手順は render-processor.ts。
// Sandbox には R2/D1 のバインディングが無いため、Worker（Queue consumer）がファイルを取り出して R2 に put する。
import { UsageLimit } from 'void/limits';
import { getSandbox, SandboxLimitError } from 'void/sandbox';
import { storage } from 'void/storage';
import type { RenderConfig } from '../lib/renderer/index.ts';
import { SANDBOX_INACTIVITY_TIMEOUT_MS } from './constants.ts';
import { errorSummary, logEvent } from './log.ts';
import {
  isSandboxFileNotFound,
  type ContainerProgress,
  type ContainerResult,
  type FileRead,
  type RenderBackend,
  type SandboxStatus,
} from './render-processor.ts';
import { isJobId } from './render-messages.ts';

// ---------------------------------------------------------------------------
// コンテナ契約（container/** と Dockerfile.sandbox 側と合わせる。変更はここだけで済むようにする）
// エラーコード / stage 名の対応表は純粋ロジック側（job-state.ts の CONTAINER_ERROR_MAP / CONTAINER_STAGE_MAP）。
// ---------------------------------------------------------------------------
const CONTAINER_ENTRY = '/app/render-entry.mjs';

export const CONTAINER_CONTRACT = {
  /** エントリスクリプト（イメージ内の絶対パス） */
  entry: CONTAINER_ENTRY,
  /** `node <entry> --config <cfgPath> --out <outDir>` */
  buildArgv: (cfgPath: string, outDir: string) => ['node', CONTAINER_ENTRY, '--config', cfgPath, '--out', outDir],
  /** ジョブ毎の作業ディレクトリ */
  workDir: (jobId: string) => `/workspace/jobs/${jobId}`,
  outputs: {
    mp4: 'preview.mp4',
    mov: 'transparent.mov',
    /** `{ ok, errorCode?, message?, totalFrames, mp4: { bytes }, mov: { bytes }, verification }` */
    result: 'result.json',
    /** `{ stage, progress, updatedAt }`。updatedAt は数秒毎に更新されるハートビート */
    progress: 'progress.json',
  },
  /** render-entry の stdout/stderr（作業ディレクトリ直下） */
  log: 'render.log',
} as const;

/**
 * render-entry を切り離して起動する sh スクリプト。パス類は位置引数（$1..$4）で渡し、文字列連結しない。
 * nohup（+ あれば setsid）で親の sh が終わっても走り続け、PID を返す。
 */
const LAUNCH_SCRIPT = [
  // 起動は 1 回だけ（同じコンテナでの再試行で 2 本目が同じ出力先に書かないように）。mkdir は原子的
  'mkdir "$3.lock" 2>/dev/null || { echo already-launched; exit 0; }',
  'S=""',
  'command -v setsid >/dev/null 2>&1 && S=setsid',
  'nohup $S node "$1" --config "$2" --out "$3" >"$4" 2>&1 </dev/null &',
  'echo $!',
].join('\n');

/** 起動コマンド自体（sh が戻るまで）の上限 */
const LAUNCH_TIMEOUT_MS = 60_000;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024; // R2 単一 put の上限（約 5 GiB）未満に抑える

/** void/limits の UsageLimit（SandboxLimitError を含む）か */
export function isUsageLimitError(err: unknown): boolean {
  return err instanceof UsageLimit || err instanceof SandboxLimitError;
}

type Sandbox = Awaited<ReturnType<typeof getSandbox>>;

function paths(jobId: string) {
  // jobId はサーバーが発行した UUID。パスとサンドボックス ID に入るので必ず検証する
  if (!isJobId(jobId)) throw new Error('invalid job id');
  const workDir = CONTAINER_CONTRACT.workDir(jobId);
  const outDir = `${workDir}/out`;
  return {
    workDir,
    outDir,
    cfgPath: `${workDir}/config.json`,
    logPath: `${workDir}/${CONTAINER_CONTRACT.log}`,
    out: (name: string) => `${outDir}/${name}`,
  };
}

function openSandbox(jobId: string): Promise<Sandbox> {
  return getSandbox(`job-${jobId}`, {
    inactivityTimeoutMs: SANDBOX_INACTIVITY_TIMEOUT_MS,
    labels: { job: jobId },
  });
}

const decoder = new TextDecoder();

async function readJsonFile<T>(sandbox: Sandbox, path: string): Promise<FileRead<T>> {
  let text: string;
  try {
    const res = await sandbox.files.readFile(path);
    text = await res.text();
  } catch (err) {
    if (isSandboxFileNotFound(err)) return { kind: 'missing' };
    return { kind: 'error', detail: errorSummary(err) };
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object') return { kind: 'error', detail: 'not a JSON object' };
    return { kind: 'ok', value: value as T };
  } catch {
    // アトミックに書いているので通常は起きない。次の poll で読み直す
    return { kind: 'error', detail: 'invalid JSON' };
  }
}

/** stat した長さで FixedLengthStream に流して R2 に put（長さ不明ストリームは R2 に拒否される）。同じキーへの上書きなので冪等。 */
async function uploadFile(sandbox: Sandbox, path: string, key: string, contentType: string): Promise<number> {
  const st = await sandbox.files.stat(path);
  const size = Number(st.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_OUTPUT_BYTES) {
    throw new Error(`invalid output size for ${key}: ${size}`);
  }
  const res = await sandbox.files.readFile(path);
  if (!res.body) throw new Error(`empty body for ${key}`);
  const { readable, writable } = new FixedLengthStream(size);
  const put = storage.put(key, readable, { httpMetadata: { contentType } });
  await Promise.all([res.body.pipeTo(writable), put]);
  return size;
}

export const sandboxBackend: RenderBackend = {
  async launch(jobId: string, config: RenderConfig): Promise<void> {
    const p = paths(jobId);
    const sandbox = await openSandbox(jobId);
    await sandbox.files.mkdir(p.outDir, { recursive: true });
    // 設定は JSON ファイルとして渡す（シェル文字列に連結しない）
    await sandbox.files.writeFile(p.cfgPath, JSON.stringify(config));
    const out = await sandbox.run(['sh', '-c', LAUNCH_SCRIPT, 'render-launch', CONTAINER_ENTRY, p.cfgPath, p.outDir, p.logPath], {
      cwd: p.workDir,
      signal: AbortSignal.timeout(LAUNCH_TIMEOUT_MS),
    });
    const stdout = decoder.decode(out.stdout).trim();
    if (out.exitCode === 0 && stdout === 'already-launched') {
      logEvent('render.process_already_started', { jobId });
      return;
    }
    if (out.exitCode !== 0 || !/^\d+$/.test(stdout)) {
      throw new Error(`launch failed: exit ${out.exitCode} ${decoder.decode(out.stderr).slice(-300)}`);
    }
    logEvent('render.process_started', { jobId, pid: Number(stdout) });
  },

  // 受容したリスク: 止まった後の getSandbox + ファイル操作は空のコンテナを起動しうる（poll は running の間だけ呼ぶ）
  async readStatus(jobId: string): Promise<SandboxStatus> {
    const p = paths(jobId);
    const sandbox = await openSandbox(jobId);
    // result を先に読む（render-entry は result.json → progress.json の順に書く）
    const result = await readJsonFile<ContainerResult>(sandbox, p.out(CONTAINER_CONTRACT.outputs.result));
    const progress = await readJsonFile<ContainerProgress>(sandbox, p.out(CONTAINER_CONTRACT.outputs.progress));
    return { result, progress };
  },

  async upload({ jobId, config, keys, result }) {
    const p = paths(jobId);
    const sandbox = await openSandbox(jobId);
    const started = Date.now();
    const mp4Bytes = await uploadFile(sandbox, p.out(CONTAINER_CONTRACT.outputs.mp4), keys.mp4, 'video/mp4');
    const movBytes = await uploadFile(sandbox, p.out(CONTAINER_CONTRACT.outputs.mov), keys.mov, 'video/quicktime');
    const metadata = {
      jobId,
      config,
      totalFrames: result.totalFrames ?? null,
      verification: result.verification ?? null,
      mp4: { key: keys.mp4, bytes: mp4Bytes, contentType: 'video/mp4' },
      mov: { key: keys.mov, bytes: movBytes, contentType: 'video/quicktime' },
      renderedAt: new Date().toISOString(),
    };
    await storage.put(keys.metadata, JSON.stringify(metadata, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });
    logEvent('render.uploaded', { jobId, mp4Bytes, movBytes, durationMs: Date.now() - started });
    return { mp4Bytes, movBytes };
  },

  async destroy(jobId: string): Promise<void> {
    if (!isJobId(jobId)) return;
    const sandbox = await openSandbox(jobId);
    await sandbox.destroy();
  },
};
