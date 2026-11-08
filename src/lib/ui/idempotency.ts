// One idempotency key per config hash for POST /api/renders.
import { ApiError } from '../api/client.ts';

/**
 * Reuses the same key while the config hash is unchanged and the previous create attempt
 * did not get a terminal response, so a resubmit after a lost response is deduplicated
 * server-side. A new hash, or a settled attempt, gets a fresh key.
 */
export class IdempotencyKeys {
  #pending: { hash: string; key: string } | null = null;
  readonly #generate: () => string;

  constructor(generate: () => string = () => crypto.randomUUID()) {
    this.#generate = generate;
  }

  keyFor(configHash: string): string {
    if (this.#pending?.hash !== configHash) {
      this.#pending = { hash: configHash, key: this.#generate() };
    }
    return this.#pending.key;
  }

  /** The server answered definitively; the next submit is a new request. */
  settle(): void {
    this.#pending = null;
  }
}

/**
 * Whether a failed create got a definitive answer from the server (4xx).
 * Network failures and 5xx may or may not have created the job, so the key is kept.
 */
export function isTerminalCreateError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}
