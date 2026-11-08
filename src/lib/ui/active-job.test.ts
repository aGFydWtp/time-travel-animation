import { describe, expect, it } from 'vitest';
import { forgetActiveJob, recallActiveJob, rememberActiveJob } from './active-job.ts';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('active job', () => {
  it('remembers, recalls and forgets the job id', () => {
    const storage = memoryStorage();
    expect(recallActiveJob(storage)).toBeNull();
    rememberActiveJob('job-1', storage);
    expect(recallActiveJob(storage)).toBe('job-1');
    forgetActiveJob(storage);
    expect(recallActiveJob(storage)).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => rememberActiveJob('x', blocked)).not.toThrow();
    expect(recallActiveJob(blocked)).toBeNull();
    expect(() => forgetActiveJob(blocked)).not.toThrow();
    expect(recallActiveJob(null)).toBeNull();
  });
});
