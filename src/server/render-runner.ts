// ジョブ専用 Sandbox でのレンダリングと R2 への保存（Void API を使う唯一の場所）。
// Sandbox には R2/D1 のバインディングが無いため、Worker（Queue consumer）がファイルを取り出して R2 に put する。
import { UsageLimit } from 'void/limits';
import { getSandbox, SandboxLimitError } from 'void/sandbox';
import { storage } from 'void/storage';
import type { RenderConfig } from '../lib/renderer/index.ts';
import { errorSummary, logEvent } from './log.ts';
import type { AssetKeys, ProgressCallback, RunResult } from './render-processor.ts';

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
    /** `{ stage, progress }` */
    progress: 'progress.json',
  },
} as const;

/** sandbox.run() の上限。Queue consumer の壁時計 15 分に収める（アップロード分を残す） */
export const RENDER_TIMEOUT_MS = 12 * 60 * 1000;
/** 無操作でコンテナが止まるまでの時間 */
export const SANDBOX_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
/** progress.json をポーリングする間隔 */
export const PROGRESS_POLL_MS = 5_000;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024; // R2 単一 put の上限（約 5 GiB）未満に抑える

/** void/limits の UsageLimit（SandboxLimitError を含む）か */
export function isUsageLimitError(err: unknown): boolean {
  return err instanceof UsageLimit || err instanceof SandboxLimitError;
}

type Sandbox = Awaited<ReturnType<typeof getSandbox>>;

interface ContainerResult {
  ok: boolean;
  errorCode?: unknown;
  message?: unknown;
  totalFrames?: unknown;
  mp4?: { bytes?: unknown };
  mov?: { bytes?: unknown };
  verification?: unknown;
}

const decoder = new TextDecoder();
const tail = (buf: ArrayBuffer, max = 500) => {
  const s = decoder.decode(buf);
  return s.length > max ? s.slice(-max) : s;
};

async function readJson(sandbox: Sandbox, path: string): Promise<unknown | null> {
  try {
    const res = await sandbox.files.readFile(path);
    return JSON.parse(await res.text()) as unknown;
  } catch {
    return null;
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
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

function startProgressPolling(sandbox: Sandbox, path: string, onProgress?: ProgressCallback) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const loop = (async () => {
    if (!onProgress) return;
    while (!stopped) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, PROGRESS_POLL_MS);
      });
      if (stopped) break;
      const p = (await readJson(sandbox, path)) as { stage?: unknown; progress?: unknown } | null;
      if (p && !stopped) await onProgress({ stage: p.stage, progress: p.progress });
    }
  })();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    wake?.();
    await loop.catch(() => undefined);
  };
}

/**
 * ジョブ専用 Sandbox で `render-entry.mjs` を実行し、MP4/MOV と metadata.json を R2 に保存する。
 * Sandbox の利用上限（UsageLimit）だけは呼び出し側で再キューするため例外のまま投げる。
 */
export async function runRenderInSandbox(
  jobId: string,
  config: RenderConfig,
  keys: AssetKeys,
  onProgress?: ProgressCallback,
): Promise<RunResult> {
  const started = Date.now();
  const workDir = CONTAINER_CONTRACT.workDir(jobId);
  const outDir = `${workDir}/out`;
  const cfgPath = `${workDir}/config.json`;
  const outPath = (name: string) => `${outDir}/${name}`;

  let sandbox: Sandbox | undefined;
  try {
    sandbox = await getSandbox(`job-${jobId}`, {
      inactivityTimeoutMs: SANDBOX_INACTIVITY_TIMEOUT_MS,
      labels: { job: jobId },
    });

    await sandbox.files.mkdir(outDir, { recursive: true });
    // 設定は JSON ファイルとして渡す（シェル文字列に連結しない）
    await sandbox.files.writeFile(cfgPath, JSON.stringify(config));
    await onProgress?.({ stage: 'starting', progress: 1 });

    const stopPolling = startProgressPolling(sandbox, outPath(CONTAINER_CONTRACT.outputs.progress), onProgress);
    let exitCode: number;
    let stderrTail = '';
    try {
      const out = await sandbox.run(CONTAINER_CONTRACT.buildArgv(cfgPath, outDir), {
        cwd: workDir,
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      });
      exitCode = out.exitCode;
      stderrTail = tail(out.stderr);
    } finally {
      await stopPolling();
    }

    const result = (await readJson(sandbox, outPath(CONTAINER_CONTRACT.outputs.result))) as ContainerResult | null;
    logEvent('render.sandbox_exit', {
      jobId,
      exitCode,
      durationMs: Date.now() - started,
      resultOk: result?.ok ?? null,
      totalFrames: typeof result?.totalFrames === 'number' ? result.totalFrames : null,
      stderrTail: exitCode !== 0 ? stderrTail : undefined,
    });

    if (!result || typeof result.ok !== 'boolean') {
      return { ok: false, errorCode: exitCode === 0 ? 'invalid_output' : 'render_failed', message: `exit ${exitCode}` };
    }
    if (!result.ok || exitCode !== 0) {
      return {
        ok: false,
        errorCode: typeof result.errorCode === 'string' ? result.errorCode : 'render_failed',
        message: typeof result.message === 'string' ? result.message.slice(0, 300) : `exit ${exitCode}`,
      };
    }

    await onProgress?.({ stage: 'uploading', progress: 95 });
    let mp4Bytes: number;
    let movBytes: number;
    try {
      mp4Bytes = await uploadFile(sandbox, outPath(CONTAINER_CONTRACT.outputs.mp4), keys.mp4, 'video/mp4');
      movBytes = await uploadFile(sandbox, outPath(CONTAINER_CONTRACT.outputs.mov), keys.mov, 'video/quicktime');
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
    } catch (err) {
      if (isUsageLimitError(err)) throw err;
      logEvent('render.upload_failed', { jobId, error: errorSummary(err) });
      await storage.delete([keys.mp4, keys.mov, keys.metadata]).catch(() => undefined);
      return { ok: false, errorCode: 'upload_failed', message: errorSummary(err) };
    }

    logEvent('render.uploaded', { jobId, mp4Bytes, movBytes, durationMs: Date.now() - started });
    return { ok: true, mp4: { bytes: mp4Bytes }, mov: { bytes: movBytes } };
  } catch (err) {
    if (isUsageLimitError(err)) throw err;
    logEvent('render.sandbox_error', { jobId, error: errorSummary(err), durationMs: Date.now() - started });
    return { ok: false, errorCode: isTimeout(err) ? 'timeout' : 'render_failed', message: errorSummary(err) };
  } finally {
    if (sandbox) {
      await sandbox.destroy().catch((err: unknown) => {
        logEvent('render.sandbox_destroy_failed', { jobId, error: errorSummary(err) });
      });
    }
  }
}
