// 5 分毎の掃除: queued の再送 / 切れた poll 連鎖の再開 / 止まった running を failed(stale) /
// 期限切れ成果物の削除 / failed ジョブの R2 掃除。
import { defineScheduled } from 'void';
import { storage } from 'void/storage';
import {
  failRunningUpdatedBefore,
  findExpiredCompleted,
  findFailedUncleaned,
  findQueuedUpdatedBefore,
  findRunningUpdatedBetween,
  markFailedJobCleaned,
  markJobExpired,
  updateJobIfStatus,
} from '../src/server/jobs-repo.ts';
import { enqueuePoll, enqueueRender } from '../src/server/jobs-service.ts';
import { POLL_DELAY_SECONDS } from '../src/server/constants.ts';
import { sandboxBackend } from '../src/server/render-runner.ts';
import { runSweep } from '../src/server/sweep.ts';

export const cron = '*/5 * * * *';

/** 1 ジョブの prefix に置くのは 3 オブジェクトだけなので 1 回の list で足りる */
const LIST_LIMIT = 100;

export default defineScheduled(async () => {
  await runSweep({
    now: () => new Date(),
    findStaleQueued: (before, limit) => findQueuedUpdatedBefore(before, limit),
    touchQueued: (id, updatedAt) => updateJobIfStatus(id, 'queued', { updatedAt }),
    send: async (id) => {
      if (!(await enqueueRender(id))) throw new Error('queue send failed');
    },
    findPollStalled: (staleBefore, before, limit) => findRunningUpdatedBetween(staleBefore, before, limit),
    sendPoll: (id) => enqueuePoll(id, POLL_DELAY_SECONDS),
    failStaleRunning: (before, patch, limit) => failRunningUpdatedBefore(before, patch, limit),
    destroySandbox: (id) => sandboxBackend.destroy(id),
    findExpired: (nowIso, limit) => findExpiredCompleted(nowIso, limit),
    deleteObjects: (keys) => storage.delete(keys),
    markExpired: (id, nowIso) => markJobExpired(id, nowIso),
    findFailedUncleaned: (before, limit) => findFailedUncleaned(before, limit),
    listObjects: async (prefix) => {
      const res = await storage.list({ prefix, limit: LIST_LIMIT });
      return { keys: res.objects.map((o) => o.key), truncated: res.truncated };
    },
    markFailedCleaned: (id) => markFailedJobCleaned(id),
  });
});
