// Queue consumer: 1 メッセージ = 1 ジョブ。D1 が状態の真実の源泉（DLQ 無し）。
import { defineQueue } from 'void';
import { env } from 'void/env';
import { DEFAULT_RETENTION_DAYS } from '../src/server/constants.ts';
import { parseRetentionDays } from '../src/server/job-state.ts';
import { claimQueuedJob, updateJobIfStatus } from '../src/server/jobs-repo.ts';
import { errorSummary, logEvent } from '../src/server/log.ts';
import { processRenderMessage } from '../src/server/render-processor.ts';
import { isUsageLimitError, runRenderInSandbox } from '../src/server/render-runner.ts';

export interface RenderMessage {
  jobId: string;
}

export const maxBatchSize = 1;
export const maxRetries = 3;

const JOB_ID_RE = /^[0-9a-f-]{36}$/i;

export default defineQueue<RenderMessage>(async (batch) => {
  for (const msg of batch.messages) {
    const jobId = msg.body?.jobId;
    if (typeof jobId !== 'string' || !JOB_ID_RE.test(jobId)) {
      logEvent('render.invalid_message', { messageId: msg.id });
      msg.ack();
      continue;
    }
    try {
      const action = await processRenderMessage(
        {
          now: () => new Date(),
          claim: (id, patch) => claimQueuedJob(id, patch),
          update: (id, patch, opts) => updateJobIfStatus(id, 'running', patch, opts),
          run: (id, config, keys, onProgress) => runRenderInSandbox(id, config, keys, onProgress),
          isUsageLimit: isUsageLimitError,
          retentionDays: parseRetentionDays(env.R2_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
        },
        jobId,
      );
      if (action.type === 'retry') msg.retry({ delaySeconds: action.delaySeconds });
      else msg.ack();
    } catch (err) {
      // D1 障害など。再配信しても CAS で二重実行はされず、取り残されたら cron が回収する
      logEvent('render.consumer_error', { jobId, attempts: msg.attempts, error: errorSummary(err) });
      msg.retry({ delaySeconds: 30 });
    }
  }
});
