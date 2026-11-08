// Reactive job state + polling shared by the editor (one tracked job) and /history (the list).
import { describeApiError, type ApiClient } from '../api/client.ts';
import type { RenderJob } from '../api/types.ts';
import { POLL_MIN_MS, classifyPollFailure, isActiveJob, jobChanged, mergeJobs, nextPollDelay } from './poll.ts';

/** Consecutive polling rounds that all failed (network/5xx) before we tell the user. */
export const CONNECTION_LOST_AFTER = 5;
export const CONNECTION_LOST_MESSAGE = '状態を取得できません。通信状況を確認してください';

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
  /** Polling keeps failing transiently; still retried with backoff, cleared on the next success. */
  connectionLost = $state(false);

  readonly #api: ApiClient;
  readonly #mode: JobTrackerOptions['mode'];
  #pollDelay = POLL_MIN_MS;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #polling = false;
  #disposed = false;
  #failStreak = 0;
  /** Set once the user paged past the first page; a refresh must not reset the cursor then. */
  #pagedBeyondFirst = false;
  /** Cancels in-flight requests on dispose (page unmount / client-side navigation). */
  readonly #abort = new AbortController();

  constructor(api: ApiClient, options: JobTrackerOptions) {
    this.#api = api;
    this.#mode = options.mode;
  }

  /** Stop polling for good (component unmount). */
  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#abort.abort();
  }

  get #opts() {
    return { signal: this.#abort.signal };
  }

  async refresh(): Promise<void> {
    if (this.#mode !== 'list') return this.#kick();
    this.loading = true;
    try {
      const page = await this.#api.listRenders({}, this.#opts);
      this.jobs = mergeJobs(this.jobs, page.items);
      // Once the user paged further (possibly to the end), the deeper cursor stays authoritative.
      if (!this.#pagedBeyondFirst) this.nextCursor = page.nextCursor;
      this.error = null;
      this.authLost = false;
    } catch (error) {
      this.error = `書き出し一覧を取得できませんでした。${describeApiError(error)}`;
    } finally {
      this.loading = false;
    }
    this.#kick();
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    try {
      const page = await this.#api.listRenders({ cursor: this.nextCursor }, this.#opts);
      this.jobs = mergeJobs(this.jobs, page.items);
      this.nextCursor = page.nextCursor;
      this.#pagedBeyondFirst = true;
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
      const job = await this.#api.getRender(id, this.#opts);
      this.jobs = this.#mode === 'single' ? [job] : mergeJobs(this.jobs, [job]);
      this.error = null;
      // A fresh successful fetch means the session works again (e.g. after signing in anew).
      this.authLost = false;
      this.connectionLost = false;
      this.#failStreak = 0;
    } catch (error) {
      if (this.#disposed) return;
      if (this.#mode === 'list') {
        await this.refresh();
        return;
      }
      this.error = describeApiError(error);
    }
    this.#kick();
  }

  /**
   * Re-attach to a job remembered from before a reload (single mode). Adopts it only while it is
   * still queued/running; returns whether it was adopted.
   */
  async resume(id: string): Promise<boolean> {
    try {
      const job = await this.#api.getRender(id, this.#opts);
      if (!isActiveJob(job) || this.jobs.length > 0) return false;
      this.jobs = [job];
      this.#kick();
      return true;
    } catch {
      return false;
    }
  }

  async retry(job: RenderJob): Promise<void> {
    this.retryingIds = new Set([...this.retryingIds, job.id]);
    try {
      const res = await this.#api.retryRender(job.id, this.#opts);
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
      const results = await Promise.allSettled(active.map((j) => this.#api.getRender(j.id, this.#opts)));
      if (this.#disposed) return;
      const fresh: RenderJob[] = [];
      const gone: string[] = [];
      let transient = 0;
      results.forEach((result, i) => {
        const before = active[i];
        if (result.status === 'rejected') {
          const failure = classifyPollFailure(result.reason);
          if (failure === 'auth') this.authLost = true;
          else if (failure === 'gone' && before) gone.push(before.id);
          else transient++;
          return;
        }
        if (jobChanged(before, result.value)) changed = true;
        if (!isActiveJob(result.value)) finished = true;
        fresh.push(result.value);
      });
      if (fresh.length > 0) this.jobs = mergeJobs(this.jobs, fresh);
      // Every request in this round failed transiently → count it; any answer resets the streak.
      if (fresh.length === 0 && transient > 0) this.#failStreak++;
      else if (fresh.length > 0) this.#failStreak = 0;
      this.connectionLost = this.#failStreak >= CONNECTION_LOST_AFTER;
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
