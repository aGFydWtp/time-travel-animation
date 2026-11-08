// 5 分毎の掃除: queued の再送 / 止まった running を failed(stale) / 期限切れ成果物の削除。
import { defineScheduled } from 'void';
import { storage } from 'void/storage';
import {
  failRunningUpdatedBefore,
  findExpiredCompleted,
  findQueuedUpdatedBefore,
  markJobExpired,
  updateJobIfStatus,
} from '../src/server/jobs-repo.ts';
import { enqueueRender } from '../src/server/jobs-service.ts';
import { runSweep } from '../src/server/sweep.ts';

export const cron = '*/5 * * * *';

export default defineScheduled(async () => {
  await runSweep({
    now: () => new Date(),
    findStaleQueued: (before, limit) => findQueuedUpdatedBefore(before, limit),
    touchQueued: (id, updatedAt) => updateJobIfStatus(id, 'queued', { updatedAt }),
    send: async (id) => {
      if (!(await enqueueRender(id))) throw new Error('queue send failed');
    },
    failStaleRunning: (before, patch, limit) => failRunningUpdatedBefore(before, patch, limit),
    findExpired: (nowIso, limit) => findExpiredCompleted(nowIso, limit),
    deleteObjects: (keys) => storage.delete(keys),
    markExpired: (id, nowIso) => markJobExpired(id, nowIso),
  });
});
