// The editor's last valid config, kept in localStorage so /history can mark "今の設定".
// Storage may be missing or throw (private mode, blocked site data); callers just get null.
import { safeParseRenderConfig } from '../renderer/schema.ts';
import type { RenderConfig } from '../renderer/types.ts';

export const LAST_CONFIG_KEY = 'date-animation:last-config';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveLastConfig(config: RenderConfig, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(LAST_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Not critical: the history page simply omits the marker.
  }
}

export function loadLastConfig(storage: StorageLike | null = defaultStorage()): RenderConfig | null {
  try {
    const raw = storage?.getItem(LAST_CONFIG_KEY);
    if (!raw) return null;
    const parsed = safeParseRenderConfig(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
