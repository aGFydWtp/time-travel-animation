// Queue consumer: start（描画をコンテナでバックグラウンド起動）/ poll（状態確認・アップロード）。
// 1 回の呼び出しは短く保つ（壁時計 15 分上限）。D1 が状態の真実の源泉（DLQ 無し）。
import { defineQueue } from 'void';
import { env } from 'void/env';
import { storage } from 'void/storage';
import { DEFAULT_RETENTION_DAYS } from '../src/server/constants.ts';
import { parseRetentionDays } from '../src/server/job-state.ts';
import { claimQueuedJob, getJob, updateJobIfStatus } from '../src/server/jobs-repo.ts';
import { enqueuePoll } from '../src/server/jobs-service.ts';
import { errorSummary, logEvent } from '../src/server/log.ts';
import { parseRenderMessage, type RenderMessage } from '../src/server/render-messages.ts';
import { processPollMessage, processStartMessage, type ProcessorDeps } from '../src/server/render-processor.ts';
import { isUsageLimitError, sandboxBackend } from '../src/server/render-runner.ts';

export type { RenderMessage };

export const maxBatchSize = 1;
export const maxRetries = 3;

const deps = (): ProcessorDeps => ({
  now: () => new Date(),
  getJob: (id) => getJob(id),
  claim: (id, patch) => claimQueuedJob(id, patch),
  update: (id, patch, opts) => updateJobIfStatus(id, 'running', patch, opts),
  enqueuePoll: (id, delaySeconds, launchedAt) => enqueuePoll(id, delaySeconds, launchedAt),
  backend: sandboxBackend,
  deleteObjects: (keys) => storage.delete(keys),
  isUsageLimit: isUsageLimitError,
  retentionDays: parseRetentionDays(env.R2_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
});

export default defineQueue<RenderMessage>(async (batch) => {
  for (const msg of batch.messages) {
    const parsed = parseRenderMessage(msg.body);
    if (!parsed) {
      logEvent('render.invalid_message', { messageId: msg.id });
      msg.ack();
      continue;
    }
    try {
      const action =
        parsed.type === 'start'
          ? await processStartMessage(deps(), parsed.jobId)
          : await processPollMessage(deps(), parsed.jobId, parsed.launchedAt);
      if (action.type === 'retry') msg.retry({ delaySeconds: action.delaySeconds });
      else msg.ack();
    } catch (err) {
      // D1 / Queue 送信の障害など。再配信しても CAS で二重実行はされず、取り残されたら cron が回収する
      logEvent('render.consumer_error', {
        jobId: parsed.jobId,
        type: parsed.type,
        attempts: msg.attempts,
        error: errorSummary(err),
      });
      msg.retry({ delaySeconds: 30 });
    }
  }
});
