# Void framework research (for Svelte 5 + Cloudflare render pipeline)

Researched: 2026-11-08

## Sources and version check

| Source | Version / status |
| --- | --- |
| `/Users/haruki/src/ikeruhi/node_modules/void/package.json` | `void@1.6.2` |
| `npm view void dist-tags` | `latest: 1.6.2` (installed = latest) |
| `npm view @void/svelte` | `1.6.2`, peer deps `svelte ^5.0.0`, `vite ^8.0.0`, `void 1.6.2`; dep `@sveltejs/vite-plugin-svelte ^7.3.1` |
| `node_modules/@cloudflare/sandbox` (dep of void) | `1.0.3` |
| Bundled docs `node_modules/void/docs/**` | Same content as live site |
| Live docs `https://void.cloud/guide/...` (fetched) | Match bundled 1.6.2 docs (guide, quickstart, pages-routing/overview, queues, sandboxes, integrations/cloudflare, reference/config) |
| `https://void.cloud/llms.txt` | 404 |

Verdict: the docs match the installed package. One small mismatch: the sandbox docs' Dockerfile snippet uses `cloudflare/sandbox:1.0.2`, while the packaged `node_modules/void/sandbox.Dockerfile` and installed `@cloudflare/sandbox` are `1.0.3`. The docs say the shim must match the installed SDK, so use **1.0.3** with void 1.6.2.

Legend: **[doc]** = stated in the official docs. **[src]** = verified in the installed `.d.mts`/`.mjs`. **[CF]** = Cloudflare platform docs. **[inferred]** / **[uncertain]** = flagged.

---

## 1. Project setup and CLI

```sh
npx void init --toolchain vite --framework svelte --starter sqlite --deploy cloudflare   # [src: void --help]
npm run dev            # dev server = Vite ("dev": "vite"). There is NO `void dev` command. [doc quickstart + CLI help]
npm run build          # = `vite build` (default build for appType "void") [doc config inference.build]
npx void deploy --platform cloudflare     # build + provision + deploy to your own CF account [doc]
npx void prepare       # generate .void types (also used as postinstall) [doc]
```

`void --help` (1.6.2) lists these commands: `init`, `migrate`, `info`, `connect`, `deploy`, `auth`, `account`, `cloudflare`, `project`, `db`, `gen`, `secret`, `env`, `github`, `build` (only `build logs`), `domain`, `email`, `platform`. **There is no `void dev` and no `void build` (for compiling).**

Deploy flags: `--platform <cloudflare|void>`, `--provision`, `--atomic`, `--require-email`, `--debug`, `--project`, `--dir`, `--spa`, `--skip-build`.

Cheat sheet (from docs/reference/cli.md): `void db push|generate|migrate [--remote]|status|reset|seed|execute [--remote]|studio|restore`, `void secret put|list|sync`, `void env check [--remote]|types`, `void gen model|route`, `void project logs|requests|rollback`.

---

## 2. Svelte pages (Pages mode)

Install and configure the plugins: [doc pages-routing/overview]

```sh
npm install @void/svelte
```

```ts
// vite.config.ts
import { voidSvelte } from '@void/svelte/plugin';
import { defineConfig } from 'vite';
import { voidPlugin } from 'void';

export default defineConfig({
  plugins: [voidPlugin(), voidSvelte()], // voidSvelte({ svelte: {...}, viewTransitions: true, prefetch: { defaultStrategy: 'hover' } })
});
```

- Pages mode turns on when a `pages/` directory exists. It can sit alongside `routes/`: pages for UI, routes for APIs.
- Files: `pages/about.svelte` or `pages/about/index.svelte`. Dynamic segments use `[id]`, catch-alls `[...slug]`, groups `(group)/`, and environment-only pages `.dev`/`.prod`.
- Companion server file: `pages/<name>.server.ts`. It exports `loader`, `action` or named actions, and optionally `ssr = false` and `prerender`.
- `@void/svelte` runtime exports [src: unpkg src/runtime/index.ts]: `Form`, `Link`, `useRouter`, `useParams`, `useShared`, `useForm`, `useNavigation`, `useIslandForm` (and others). The Svelte 5 APIs `mount`, `hydrate`, and `svelte/server` `render` are used internally.

Loader → props (Svelte 5 runes): [doc loaders]

```ts
// pages/jobs/[id].server.ts
import { jobs } from '@schema';
import { defineHandler, defer } from 'void';
import type { InferProps } from 'void';
import { db, eq } from 'void/db';

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const id = c.req.param('id');
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return { job, slow: defer(async () => computeSlow()) };
});
```

```svelte
<!-- pages/jobs/[id].svelte -->
<script lang="ts">
  import type { Props } from './[id].server';
  let { job, slow }: Props = $props();
</script>
{#if slow.loading}…{:else if slow.error}{slow.error.message}{:else}{slow.value}{/if}
```

`Deferred<T>` in Svelte is `{loading:true,value:null,error:null} | {loading:false,value:T,error:null} | {loading:false,value:null,error:Error}`.

Layouts: [doc layouts]

```svelte
<!-- pages/layout.svelte  (nested: pages/users/layout.svelte) -->
<script>
  import { useShared, Link } from "@void/svelte";
  let { children } = $props();
  const { auth } = useShared();
</script>
<nav><Link href="/">Home</Link></nav>
<main>{@render children()}</main>
```

- Named layouts live in `pages/_layouts/<name>.svelte`. A page selects one with `export const layout = "landing"` (or `"!landing"` to replace the whole chain, or `false` for no layout).
- **The docs show this export in `<script context="module">`, which is Svelte 4 syntax.** Svelte 5 prefers `<script module>` and deprecates `context="module"`. [uncertain] I did not verify whether Void's layout detection recognises `<script module>`. Test it, or keep `context="module"` and accept the deprecation warning.
- Shared data: middleware calls `c.set('shared', {...})` and you augment `CloudContextVariables` in `declare module 'void'`. Read it with `useShared()`.

Navigation: `<Link href=... prefetch replace reloadDocument preserveScroll activeMatch="prefix">`, plus `useRouter().visit/prefetch/refresh/flush`. `routeUrl('/users/:id', { params })` comes from `void/routes`.

Forms/actions: `import { Form, useForm, action, isVoidActionError } from "@void/svelte"`. In Svelte, submissions return `Promise<void>`.

---

## 3. API routes (`routes/`)

[doc server-routing, reference/api/handlers]

```ts
// routes/api/jobs/[id].ts → GET/POST /api/jobs/:id
import { defineHandler } from 'void';

export const GET = defineHandler(async (c) => {
  const id = c.req.param('id');            // Hono context
  if (!id) return c.json({ error: 'x' }, 400);
  return { id };                            // object → JSON
});

export const POST = defineHandler.withValidator({ body: zodOrValibotSchema })(async (c, { body }) => {
  return c.json({ ok: true }, 201);
});
```

- The handler receives a Hono `Context` (`CloudContext`) with typed bindings on `c.env`.
- Return value conversion: object/array/number/boolean → JSON. `string` → `text/html`. `null`/`undefined` → 204. `Response` → returned as-is.
- Status codes, redirects and streaming use the Hono API: `c.json(data, status)`, `c.redirect(url, 302)`, `c.notFound()`, `c.header()`, or `return new Response(readableStream, { headers })`. A streaming body works because `Response` passes through unchanged. Hono `stream()` / `streamSSE()` helpers come from `hono/streaming` (`hono` must be a dependency). Void also has `void/sse`. [inferred from "full Hono API"; not separately documented]
- `GET` also answers `HEAD`. Validation failures return a 400 `{ error: 'Validation failed', issues: [...] }`.
- Middleware: `middleware/01.name.ts` with `export default defineMiddleware(async (c, next) => {...})`, or per-route `defineHandler(mw1, mw2, handler)` (up to 5).
- Hono JSX in a Svelte app needs `oxc: { jsx: { runtime: 'automatic', importSource: 'hono/jsx' } }` (only if you want `.tsx` routes).

---

## 4. Queues

[doc guide/queues, reference/api/handlers; src handler-*.d.mts, route-types-*.mjs, index.mjs]

Consumer: the file path gives the queue name (`queues/render.ts` → `render`, `queues/a/b.ts` → `a-b`). Files and directories starting with `_` are ignored.

```ts
// queues/render.ts
import { defineQueue } from 'void';

export interface RenderMsg { jobId: string }

export const maxBatchSize = 1;      // default 10 (CF max 100)
export const maxBatchTimeout = 5;   // seconds, default 5
export const maxRetries = 3;        // default 3
export const retryDelay = 30;       // seconds, default 0

export default defineQueue<RenderMsg>(async (batch, env) => {
  for (const msg of batch.messages) {
    try { /* ... */ msg.ack(); }
    catch { msg.retry({ delaySeconds: 60 }); }
  }
});
```

Exact types [src]:

```ts
function defineQueue<T>(handler: (batch: QueueBatch<T>, env: CloudEnv['Bindings']) => void | Promise<void>): TypedQueueHandler<T>;
type QueueBatch<T>   = { readonly queue: string; readonly messages: QueueMessage<T>[]; ackAll(): void; retryAll(o?: QueueRetryOptions): void };
type QueueMessage<T> = { readonly id: string; readonly timestamp: Date; readonly body: T; readonly attempts: number; ack(): void; retry(o?: QueueRetryOptions): void };
type QueueRetryOptions = { delaySeconds?: number };
```

There is **no `ctx` (ExecutionContext) argument** in the consumer signature.

Semantics: the first `ack()`/`retry()` wins. Messages without a decision are acked if the handler resolves and retried if it throws.

Producer (from any route, loader, cron or consumer):

```ts
import { queues } from 'void/queues';
await queues.render.send({ jobId });                         // typed from defineQueue<T>
await queues.render.send({ jobId }, { delaySeconds: 30 });   // [src] QueueMap entries are CF `Queue<T>` → send(body, QueueSendOptions) and sendBatch()
```

The generated `.void/queues.d.ts` declares `"render": Queue<typeof import(...)["default"]["__payload"]>` (Cloudflare workers-types `Queue<T>`). `sendBatch` and the `delaySeconds`/`contentType` options therefore exist at the type level. The docs show only `send(body)`.

Bindings: producer bindings are `QUEUE_*`. On direct Cloudflare deploys the queue is named `<worker-name>-<queue>` (63-character limit). Each CF queue allows one consumer.

What you can configure [src: index.mjs ~L5276]: Void emits only `max_batch_size`, `max_batch_timeout`, `max_retries` and `retry_delay`.
- **No `max_concurrency` knob.**
- **No DLQ.** The docs say: "Void-managed queues do not configure a dead-letter queue". Messages that exhaust their retries are permanently deleted.
- Void assigns `result.queues = {...}`, so I am not sure a `cloudflare.queues` override in `void.config.ts` would survive. [uncertain]

Local dev: sending through the binding automatically invokes the consumer in Miniflare (native Void apps). For a manual trigger, POST to `/__void/queue` with the `x-void-dev-trigger: <token printed at dev start>` header and the body `{"queue":"render","messages":[{"id":"1","timestamp":<ms>,"body":{...},"attempts":1}]}`.

Runtime env inside consumers [src wrapper-*.mjs L628-629]: `handleQueue` is wrapped in `withRuntimeEnv(env, ...)`. That means `db` (`void/db`), `storage` (`void/storage`), `getSandbox` (`void/sandbox`), `env` (`void/env`) and `queues` all work inside `defineQueue`.

CF limits [CF queues/platform/limits]:
- Consumer wall-clock limit is **15 minutes** per invocation.
- Consumer CPU time is configurable up to 5 minutes.
- Message size is 128 KB.
- `delaySeconds` can be at most 24 h.
- Up to 250 concurrent push consumers.
- Up to 100 retries.

---

## 5. Sandboxes

[doc guide/sandboxes, reference/config#sandbox; src sandbox-*.d.mts, sandbox-container-*.{d.mts,mjs}, @cloudflare/sandbox 1.0.3 types, workers-types]

Requirements: Workers Paid plus Containers access. **Docker** must be running for local dev and for direct deploys that build an image. Importing `void/sandbox` enables the resources automatically.

```ts
import { getSandbox, SandboxLimitError, SandboxUnavailableError } from 'void/sandbox';
import { UsageLimit } from 'void/limits';

const sandbox = await getSandbox(`job-${jobId}`, {
  inactivityTimeoutMs: 60 * 60 * 1000, // default 600_000 (10 min); integer 1..21_600_000 (6 h) [src validateSandboxOptions]
  enableInternet: false,               // default false; applies on next container start
  labels: { job: jobId },              // Record<string,string>; applies on next start
  normalizeId: true,                   // default: id lowercased; ids 1–63 chars
  // binding?: string                  // custom native binding
});
```

Exact client type [src]:

```ts
function getSandbox(id?: string /* default 'default' */, options?: VoidSandboxOptions): Promise<SandboxClient>;
type SandboxClient = {
  exec(argv: string[], options?: SandboxExecOptions): Promise<SandboxProcess>;
  run(argv: string[], options?: SandboxExecOptions): Promise<ExecOutput>;
  files: SandboxFiles;              // readFile, writeFile, stat, lstat, readDirectory, mkdir, rename, remove
  fetch(port: number, request: Request): Promise<Response>;
  running(): Promise<boolean>;
  destroy(): Promise<void>;
};
interface ExecOutput { readonly stdout: ArrayBuffer; readonly stderr: ArrayBuffer; readonly exitCode: number }
type SandboxExecOptions = { cwd?: string /* default /workspace */; env?: Record<string,string>; user?: string;
  signal?: AbortSignal; pty?: boolean | {cols?: number; rows?: number};
  stdin?: ReadableStream | 'pipe'; stdout?: 'pipe' | 'ignore'; stderr?: 'pipe' | 'ignore' | 'combined' };
type SandboxProcess = { pid: number; isPty: boolean; stdin: WritableStream|null; stdout: ReadableStream|null; stderr: ReadableStream|null;
  readonly exitCode: Promise<number>; output(): Promise<ExecOutput>; kill(signal?: number): Promise<void>; resize(c: number, r: number): Promise<void> };
```

- `argv` is an array. For shell syntax use `['sh','-c', cmd]`.
- **There is no per-command timeout option.** Use `signal: AbortSignal.timeout(ms)`.
- `getSandbox()` does not start the container. The first command, file operation or port request does.

Files [src @cloudflare/sandbox Files]:

```ts
readFile(path, opts?): Promise<Response>        // streaming; .arrayBuffer() / .text() / .body
writeFile(path, content: string|ArrayBuffer|ArrayBufferView|Blob|ReadableStream<Uint8Array>, opts?): Promise<void>
stat(path, opts?): Promise<{ type; size: bigint; mode; uid; gid; accessedAt; modifiedAt; changedAt }>
readDirectory(path, opts?): Promise<{ name; type }[]>
mkdir(path, { recursive? }), rename(src, dst), remove(path, { recursive?, force? })
// FileOperationOptions = { cwd?: string; user?: 'uid:gid'; signal?: AbortSignal }  (relative path requires cwd)
```

Limits and errors: `SandboxLimitError extends UsageLimit`, with `reason: 'concurrency' | 'runtime_budget'` and `resource: 'sandbox'`. Uncaught in a route handler, it becomes an HTTP 429. `UsageLimit#response({message})` is available. `SandboxUnavailableError` also exists.

Lifecycle and state:
- The same ID maps to the same Durable Object.
- Files, processes and servers live only as long as the container, which can stop on inactivity, crash or restart. Persist outputs to R2/D1/KV.
- `exec()`: "Waiting for completion keeps a long command active during pauses in its output; **unattended background commands can stop when the Sandbox becomes idle**." [doc]

Config (`void.config.ts`) [doc reference/config#sandbox]:

```ts
import { defineConfig } from 'void/config';
export default defineConfig({
  sandbox: {
    image: './Dockerfile.sandbox',   // default: packaged Node.js Dockerfile
    imageBuildContext: '.',          // default: directory of image
    instanceType: 'standard-2',      // default 'lite'; allowed: lite | standard-1..standard-4
    // binding: 'SANDBOX', className: 'SandboxV1', containerName: 'void-sandbox-v1',
    // platformImage: 'registry.cloudflare.com/<acct>/sandbox@sha256:<digest>'  (managed Void platform only)
  },
});
```

Instance sizes [CF containers limits]:

| Instance type | vCPU | Memory | Disk |
| --- | --- | --- | --- |
| `lite` | 1/16 | 256 MiB | 2 GB |
| `standard-1` | 1/2 | 4 GiB | 8 GB |
| `standard-2` | 1 | 6 GiB | 12 GB |
| `standard-3` | 2 | 8 GiB | 16 GB |
| `standard-4` | 4 | 12 GiB | 20 GB |

Void's type does not allow CF's `basic` or custom sizes.

Default image (`node_modules/void/sandbox.Dockerfile`) has **no Chromium or FFmpeg**:

```dockerfile
FROM node:26.12.1-trixie-slim
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
WORKDIR /workspace
CMD ["sleep", "infinity"]
```

A custom image must keep the `sandbox-shim` COPY at the version matching the installed `@cloudflare/sandbox` (1.0.3). Example for this project (untested):

```dockerfile
FROM node:26.12.1-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
WORKDIR /workspace
COPY render/ /opt/render/
CMD ["sleep", "infinity"]
```

Getting output bytes out to R2 (the container has **no** R2/D1 bindings). The Worker pulls the file and writes R2. R2 `put()` with a `ReadableStream` **requires a known length** [CF R2 API], so a raw `readFile().body` may be rejected. Use the stat size plus a `FixedLengthStream`:

```ts
const st = await sandbox.files.stat('/workspace/out/video.mp4');
const res = await sandbox.files.readFile('/workspace/out/video.mp4');
const { readable, writable } = new FixedLengthStream(Number(st.size));
const upload = storage.put(`renders/${jobId}.mp4`, readable, { httpMetadata: { contentType: 'video/mp4' } });
await res.body!.pipeTo(writable);
await upload;
// small files: await storage.put(key, await res.arrayBuffer())   (Worker memory ~128 MB)
// very large files: storage.createMultipartUpload + uploadPart (parts also need known length)
```

[uncertain] `@cloudflare/sandbox` 1.0.3 types include S3-mount and directory backup contracts (`S3MountAccess`, `backup`/`restore`). `void/sandbox` does `export * from "@cloudflare/sandbox"`, but Void's `SandboxClient` exposes only the methods listed above. Direct R2 mounting from Void is **unverified**. Do not rely on it.

Local dev: the same runtime API runs against Docker. Direct access through `c.env.SANDBOX` works only locally and on native CF deploys; prefer `getSandbox()`.

---

## 6. Database (D1 + Drizzle)

[doc guide/database, database/d1, reference/cli/database]

- Schema lives in `db/schema.ts`, or split under `db/schema/*.ts` and re-exported from `db/schema.ts`. Import tables through the `@schema` alias (set up automatically by Vite).
- Migrations go to `db/migrations/*.sql`. An optional seed lives at `db/seed.ts` or `db/seed.sql`.
- With `sourceDir: 'src'`, everything moves under `src/`.

```ts
// db/schema.ts
import { sql } from 'void/db';
import { sqliteTable, text, integer } from 'void/schema-d1';
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('queued'),
  outputKey: text('output_key'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

```ts
import { jobs } from '@schema';
import { db, eq, and, desc } from 'void/db';     // Drizzle operators re-exported; no drizzle-orm install needed
await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, id));
await db.batch([...]);                            // D1 batch
// raw: import { env } from 'cloudflare:workers'; env.DB.prepare(...)   or c.env.DB
// createDb(d1) for a custom binding; createPrimaryDb used internally for 'first-primary'
```

Commands:

```sh
void db push          # prototype: apply schema locally, no migration files
void db generate      # write SQL migrations to db/migrations/
void db migrate       # apply pending locally; --remote for the deployed DB
void deploy           # applies migrations remotely and deploys
void db execute "SELECT ..." [--remote]
```

Validators can be derived from the schema with `void/drizzle-zod`, `void/drizzle-valibot` or `void/drizzle-arktype` (`createInsertSchema`).

---

## 7. Storage (R2)

[doc guide/storage; src runtime/storage.d.mts]

```ts
import { storage, createStorage } from 'void/storage';   // storage: R2Bucket (proxy over binding STORAGE)
await storage.put(key, body, { httpMetadata: { contentType: 'video/mp4' } });
const obj = await storage.get(key, { range: { offset: 0, length: 1024 } });   // also range: Headers (pass request headers)
await storage.head(key); await storage.delete(key); await storage.list({ prefix });
```

Serving with Range support (the docs show a basic version). Range uses the standard R2 API:

```ts
// routes/files/[key].ts
export const GET = defineHandler(async (c) => {
  const obj = await storage.get(`renders/${c.req.param('key')}`, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
  if (!obj) return c.notFound();
  const h = new Headers(); obj.writeHttpMetadata(h); h.set('etag', obj.httpEtag); h.set('accept-ranges', 'bytes');
  if (!('body' in obj)) return new Response(null, { status: 304, headers: h });
  if (obj.range && 'offset' in obj.range) {
    const start = obj.range.offset ?? 0, len = obj.range.length ?? obj.size - start;
    h.set('content-range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers: h });
  }
  return new Response(obj.body, { headers: h });
});
```

The binding is `STORAGE` by default. Rename it with `inference.bindings.storage: 'MY_BUCKET'`. Locally, R2 uses local data.

---

## 8. Env / secrets

[doc guide/env-vars]

```ts
// env.ts (project root)
import { defineEnv, string, url, number, boolean, oneOf, json } from 'void/env';
export default defineEnv({ RENDER_SECRET: string(), VITE_PUBLIC_ORIGIN: url().default('https://x') });
// use: import { env } from 'void/env'; env.RENDER_SECRET
```

- Local values go in a single root `.env`. `.dev.vars` and `.env.local` are not supported.
- Production values are set with `void secret put NAME` or `void secret sync file`.
- `VITE_*` keys are client values and are not secrets.
- `worker.vars` in `void.config.ts` holds plain-text vars.
- tsconfig: `"types": ["void/env"]`.

---

## 9. Auth (built-in, Better Auth)

[doc guide/auth]

Auth turns on when you import from `void/auth`, import `auth` from `void/client`, add `auth` to `void.config.ts`, or add a root `auth.ts`.

- Server: `import { getUser, getSession, requireAuth } from 'void/auth'`. `requireAuth(c)` throws 401.
- Client: `import { auth } from 'void/client'` (Better Auth client at `/api/auth`).
- Providers: config `auth.providers: ['email','google','github']` with `AUTH_<PROVIDER>_CLIENT_ID/SECRET`.
- Auth tables are included in `void db generate`.
- `basicAuth()` from `void` is available as a temporary site gate.

---

## 10. Crons

[doc guide/jobs]

```ts
// crons/cleanup.ts
import { defineScheduled } from 'void';
export const cron = '0 * * * *';          // or string[]
export default defineScheduled(async (controller, env, ctx) => { /* ... */ });
```

- Crons do not fire locally. Trigger them with `POST /__void/scheduled` and the `x-void-dev-trigger` header.
- The CF cron wall-clock limit is 15 minutes.

---

## 11. Cloudflare integration and config

[doc integrations/cloudflare, reference/config]

- Bindings: `DB` (D1), `KV`, `STORAGE` (R2), `AI`, `ASSETS`, `QUEUE_*`, Durable Objects from `durable-objects/`, and `SANDBOX` (Sandbox DO).
- `void.config.ts` uses `defineConfig` from `void/config`. Keys: `sourceDir`, `ai`, `auth`, `database`, `email`, `head`, `output`, `remote`, `sandbox`, `target`, `worker` (`compatibility_date`, `compatibility_flags`, `vars`, `limits.cpu_ms`), `cloudflare` (pass-through wrangler fields: `name`, `account_id`, `d1_databases`, `r2_buckets`, `routes`, `services`, ...), `deploy.cloudflare.mode` (`staged` default | `atomic`), `routing.*`, and `inference.*` (`bindings`, `build`, `scanDirs`, `appType`, `outputDir`).
- Commit `void.lock.json` (resource IDs). Keep generated CF config out of git.
- CI needs `CLOUDFLARE_API_TOKEN` and, optionally, `CLOUDFLARE_ACCOUNT_ID`.

---

## 12. Evaluation of the design: "Queue consumer calls getSandbox(jobId), sandbox runs Chromium+FFmpeg, uploads to R2, updates D1"

Overall, the pattern is supported. `getSandbox`, `storage` and `db` all work inside `defineQueue`, because the consumer runs under `withRuntimeEnv` [src]. The following points contradict or constrain the design:

1. **"Sandbox uploads to R2" / "updates D1": the container has no bindings.** The container is a plain Linux box. R2 and D1 access happens in the **Worker (the queue consumer)**: render in the sandbox, `files.stat` + `files.readFile` in the consumer, `storage.put`, then `db.update`. Uploading from inside the container would need S3 API credentials and `enableInternet: true`. Void exposes no R2 mount (unverified in the SDK).
2. **15-minute queue consumer wall-clock limit [CF].** If the consumer awaits `sandbox.run()` for the whole render plus upload, the job must finish in under 15 min. Otherwise the invocation dies, the message retries (default 3) and the render may run again. For longer renders:
   - start the job with `exec()` (detached, e.g. `sh -c 'nohup … > /workspace/log 2>&1 & echo started'`) and set a large `inactivityTimeoutMs` (up to 6 h);
   - make the consumer re-enqueue itself with `send({jobId}, {delaySeconds})` or `msg.retry({delaySeconds})` to poll for a done-marker via `files.stat`.

   Caveat from the docs: "unattended background commands can stop when the Sandbox becomes idle". Polling with file operations likely counts as activity. [inferred, untested]
3. **The default image lacks Chromium and FFmpeg.** You need a custom `sandbox.image` Dockerfile that includes the `sandbox-shim` from `cloudflare/sandbox:1.0.3`. The docs snippet says 1.0.2; match the installed SDK instead.
4. **The default instance is `lite` (1/16 vCPU, 256 MiB, 2 GB disk).** Chromium plus FFmpeg needs at least `standard-1`, realistically `standard-2` to `standard-4` (max 4 vCPU / 12 GiB / 20 GB disk). Disk limits the frames you can hold as intermediate files.
5. **`enableInternet` defaults to `false`.** If Chromium loads the app URL, a CDN, fonts or remote assets, set `enableInternet: true`. Otherwise bake assets into the image or `files.writeFile` them in. The setting applies on the next container start.
6. **Sandbox IDs** are 1–63 characters and lowercased by default. A UUID jobId fits; `job-${uuid}` is 40 characters. Use `normalizeId: false` if case matters. Call `sandbox.destroy()` after uploading to free concurrency.
7. **There is no DLQ and no `max_concurrency` knob in Void.** Exhausted messages are deleted. Keep job state in D1 (`queued/running/done/failed`) as the source of truth, and add a cron sweeper for stuck jobs. Concurrent renders can hit `SandboxLimitError('concurrency')`; catch it with `instanceof UsageLimit` and `msg.retry({ delaySeconds })`. Set `maxBatchSize = 1` so one message equals one render.
8. **Returning bytes to R2:** `readFile()` returns a streaming `Response`, but R2 `put` needs a known length. Use `stat().size` (bigint → `Number`) with a `FixedLengthStream`, or `arrayBuffer()` for small files, or multipart upload.
9. **Local dev:** queue sends auto-invoke the consumer (Miniflare). The sandbox needs Docker running. Local wall-clock limits may differ from production. [uncertain]
10. **Deploy:** `void deploy --platform cloudflare` builds the image with Docker and deploys the Sandbox. It requires Workers Paid and Containers access.

### Sketch (untested)

```ts
// queues/render.ts
import { defineQueue } from 'void';
import { getSandbox } from 'void/sandbox';
import { UsageLimit } from 'void/limits';
import { storage } from 'void/storage';
import { db, eq } from 'void/db';
import { jobs } from '@schema';

export const maxBatchSize = 1;
export const maxRetries = 5;

export default defineQueue<{ jobId: string }>(async (batch) => {
  for (const msg of batch.messages) {
    const { jobId } = msg.body;
    const sb = await getSandbox(`job-${jobId}`, { inactivityTimeoutMs: 30 * 60_000, enableInternet: true });
    try {
      await db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, jobId));
      const r = await sb.run(['node', '/opt/render/render.mjs', jobId], { signal: AbortSignal.timeout(13 * 60_000) });
      if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr));
      const path = '/workspace/out.mp4';
      const st = await sb.files.stat(path);
      const res = await sb.files.readFile(path);
      const { readable, writable } = new FixedLengthStream(Number(st.size));
      const put = storage.put(`renders/${jobId}.mp4`, readable, { httpMetadata: { contentType: 'video/mp4' } });
      await res.body!.pipeTo(writable); await put;
      await db.update(jobs).set({ status: 'done', outputKey: `renders/${jobId}.mp4` }).where(eq(jobs.id, jobId));
      msg.ack();
      await sb.destroy();
    } catch (e) {
      if (e instanceof UsageLimit) { msg.retry({ delaySeconds: 60 }); continue; }
      if (msg.attempts >= maxRetries) await db.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, jobId));
      msg.retry({ delaySeconds: 30 });
    }
  }
});
```
