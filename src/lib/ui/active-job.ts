// The export started from the editor, kept in sessionStorage so a reload can resume tracking it.
// Storage may be missing or throw (private mode, blocked site data); then nothing is resumed.

export const ACTIVE_JOB_KEY = 'date-animation:active-job';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function rememberActiveJob(id: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(ACTIVE_JOB_KEY, id);
  } catch {
    // Not critical: a reload just won't resume.
  }
}

export function recallActiveJob(storage: StorageLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(ACTIVE_JOB_KEY) || null;
  } catch {
    return null;
  }
}

export function forgetActiveJob(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(ACTIVE_JOB_KEY);
  } catch {
    // ignore
  }
}
