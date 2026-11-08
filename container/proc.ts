import { spawn } from 'node:child_process';

export interface RunOptions {
  /** Called with each complete stdout line (stdout is then not buffered). */
  onStdoutLine?: (line: string) => void;
  /** Max stderr bytes kept for error messages. */
  stderrLimit?: number;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

export class ProcessError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(command: string, exitCode: number | null, stderr: string) {
    super(`${command} exited with ${exitCode}: ${stderr.trim().slice(-500)}`);
    this.name = 'ProcessError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Spawn argv[0] with argv[1..] (no shell) and collect output.
 * Rejects with ProcessError on a non-zero exit.
 */
export function run(argv: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const [command, ...args] = argv;
  if (!command) return Promise.reject(new Error('run: empty argv'));
  const stderrLimit = options.stderrLimit ?? 16_384;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const chunks: Buffer[] = [];
    let stderr = '';
    let pending = '';

    child.stdout.on('data', (chunk: Buffer) => {
      if (!options.onStdoutLine) {
        chunks.push(chunk);
        return;
      }
      pending += chunk.toString('utf8');
      let nl = pending.indexOf('\n');
      while (nl !== -1) {
        options.onStdoutLine(pending.slice(0, nl).trim());
        pending = pending.slice(nl + 1);
        nl = pending.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > stderrLimit) stderr = stderr.slice(-stderrLimit);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(chunks), stderr });
      else reject(new ProcessError(command, code, stderr));
    });
  });
}
