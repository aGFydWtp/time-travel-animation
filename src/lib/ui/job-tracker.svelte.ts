// Reactive job state + polling shared by the editor (one tracked job) and /history (the list).
import { describeApiError, type ApiClient } from '../api/client.ts';
import type { RenderJob } from '../api/types.ts';
import { POLL_MIN_MS, classifyPollFailure, isActiveJob, jobChanged, mergeJobs, nextPollDelay } from './poll.ts';

export const AUTH_LOST_MESSAGE =
  'ログインの有効期限が切れた可能性があります。ページを再読み込みして、もう一度サインインしてください。';

export interface JobTrackerOptions {
  /**
   * `list`: paged history (GET /api/renders), refreshed when a job settles.
   * `single`: only the most recently tracked job (the editor's inline status).
   */
  mode: 'list' | 'single';
}

export class JobTracker {
  jobs: RenderJob[] = $state([]);
  nextCursor: string | null = $state(null);
  loading = $state(false);
  loadingMore = $state(false);
  error: string | null = $state(null);
  retryingIds: ReadonlySet<string> = $state(new Set());
  /** Jobs that returned 404 while polling; they are no longer polled. */
  unavailableIds: ReadonlySet<string> = $state(new Set());
  /** Set on 401/403 while polling; polling stays stopped until a list refresh succeeds. */
  authLost = $state(false);

  readonly #api: ApiClient;
  readonly #mode: JobTrackerOptions['mode'];
  #pollDelay = POLL_MIN_MS;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #polling = false;
  #disposed = false;

  constructor(api: ApiClient, options: JobTrackerOptions) {
    this.#api = api;
    this.#mode = options.mode;
  }

  /** Stop polling for good (component unmount). */
  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
  }

  async refresh(): Promise<void> {
    if (this.#mode !== 'list') return this.#kick();
    this.loading = true;
    try {
      const page = await this.#api.listRenders();
      this.jobs = mergeJobs(this.jobs, page.items);
      // Keep a deeper cursor if the user already paged further.
      if (this.nextCursor === null || this.jobs.length <= page.items.length) this.nextCursor = page.nextCursor;
      this.error = null;
      this.authLost = false;
    } catch (error) {
      this.error = `書き出し履歴を取得できませんでした。${describeApiError(error)}`;
    } finally {
      this.loading = false;
    }
    this.#kick();
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    try {
      const page = await this.#api.listRenders({ cursor: this.nextCursor });
      this.jobs = mergeJobs(this.jobs, page.items);
      this.nextCursor = page.nextCursor;
      this.error = null;
    } catch (error) {
      if (!this.authLost) this.error = `続きを取得できませんでした。${describeApiError(error)}`;
    } finally {
      this.loadingMore = false;
    }
    this.#kick();
  }

  /** Fetch one job (just created or retried) and keep polling it while active. */
  async track(id: string): Promise<void> {
    try {
      const job = await this.#api.getRender(id);
      this.jobs = this.#mode === 'single' ? [job] : mergeJobs(this.jobs, [job]);
      this.error = null;
    } catch (error) {
      if (this.#mode === 'list') {
        await this.refresh();
        return;
      }
      this.error = describeApiError(error);
    }
    this.#kick();
  }

  async retry(job: RenderJob): Promise<void> {
    this.retryingIds = new Set([...this.retryingIds, job.id]);
    try {
      const res = await this.#api.retryRender(job.id);
      await this.track(res.id);
    } catch (error) {
      this.error = describeApiError(error);
    } finally {
      const next = new Set(this.retryingIds);
      next.delete(job.id);
      this.retryingIds = next;
    }
  }

  /** Restart polling at the base interval (new/changed active jobs). */
  #kick(): void {
    this.#pollDelay = POLL_MIN_MS;
    this.#schedule();
  }

  #pollable(): RenderJob[] {
    return this.jobs.filter((job) => isActiveJob(job) && !this.unavailableIds.has(job.id));
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    if (this.#disposed || this.#polling || this.authLost || this.#pollable().length === 0) return;
    this.#timer = setTimeout(() => void this.#pollOnce(), this.#pollDelay);
  }

  async #pollOnce(): Promise<void> {
    this.#polling = true;
    let changed = false;
    let finished = false;
    try {
      const active = this.#pollable();
      const results = await Promise.allSettled(active.map((j) => this.#api.getRender(j.id)));
      const fresh: RenderJob[] = [];
      const gone: string[] = [];
      results.forEach((result, i) => {
        const before = active[i];
        if (result.status === 'rejected') {
          const failure = classifyPollFailure(result.reason);
          if (failure === 'auth') this.authLost = true;
          else if (failure === 'gone' && before) gone.push(before.id);
          return;
        }
        if (jobChanged(before, result.value)) changed = true;
        if (!isActiveJob(result.value)) finished = true;
        fresh.push(result.value);
      });
      if (this.#disposed) return;
      if (fresh.length > 0) this.jobs = mergeJobs(this.jobs, fresh);
      if (gone.length > 0) {
        this.unavailableIds = new Set([...this.unavailableIds, ...gone]);
        changed = true;
      }
    } finally {
      this.#polling = false;
    }
    if (this.authLost) {
      clearTimeout(this.#timer);
      this.error = AUTH_LOST_MESSAGE;
      return;
    }
    this.#pollDelay = nextPollDelay(this.#pollDelay, changed);
    if (finished && this.#mode === 'list') {
      // A job settled: refresh so retries/new jobs from elsewhere show up too.
      await this.refresh();
      return;
    }
    this.#schedule();
  }
}
