import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../renderer/types.ts';
import { LAST_CONFIG_KEY, loadLastConfig, saveLastConfig } from './last-config.ts';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('last config', () => {
  it('round-trips a valid config', () => {
    const storage = memoryStorage();
    saveLastConfig({ ...DEFAULT_CONFIG, fps: 24 }, storage);
    expect(loadLastConfig(storage)).toEqual({ ...DEFAULT_CONFIG, fps: 24 });
  });

  it('returns null for missing, corrupt or invalid data', () => {
    const storage = memoryStorage();
    expect(loadLastConfig(storage)).toBeNull();
    storage.data.set(LAST_CONFIG_KEY, '{not json');
    expect(loadLastConfig(storage)).toBeNull();
    storage.data.set(LAST_CONFIG_KEY, JSON.stringify({ ...DEFAULT_CONFIG, fps: 7 }));
    expect(loadLastConfig(storage)).toBeNull();
    expect(loadLastConfig(null)).toBeNull();
  });

  it('never throws when storage does', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => saveLastConfig(DEFAULT_CONFIG, throwing)).not.toThrow();
    expect(loadLastConfig(throwing)).toBeNull();
  });
});
