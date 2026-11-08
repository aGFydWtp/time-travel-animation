import { describe, expect, it } from 'vitest';
import { safeParseRenderConfig } from '../renderer/schema.ts';
import { DEFAULT_CONFIG } from '../renderer/types.ts';
import { defaultForm, fieldErrors, formFromConfig, formToConfigInput, normalizeHex } from './editor-form.ts';

describe('form <-> config', () => {
  it('default form parses to DEFAULT_CONFIG', () => {
    const parsed = safeParseRenderConfig(formToConfigInput(defaultForm()));
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips a non-default config (load into editor)', () => {
    const config = { ...DEFAULT_CONFIG, width: 1280 as const, height: 720 as const, fps: 24 as const, x: 0.2 };
    const parsed = safeParseRenderConfig(formToConfigInput(formFromConfig(config)));
    expect(parsed.data).toEqual(config);
  });

  it('empty number inputs are invalid', () => {
    const parsed = safeParseRenderConfig(formToConfigInput({ ...defaultForm(), durationSeconds: null, fontSize: null }));
    expect(parsed.success).toBe(false);
    const errors = fieldErrors(parsed.error?.issues);
    expect(Object.keys(errors).sort()).toEqual(['durationSeconds', 'fontSize']);
  });
});

describe('fieldErrors', () => {
  it('maps width/height issues to the resolution field', () => {
    expect(fieldErrors([{ path: ['height'] }])).toHaveProperty('resolution');
  });

  it('reports invalid dates and out-of-range values per field', () => {
    const parsed = safeParseRenderConfig(
      formToConfigInput({ ...defaultForm(), startDate: '2026-02-30', durationSeconds: 61, color: 'red' }),
    );
    const errors = fieldErrors(parsed.error?.issues);
    expect(errors.startDate).toBeTruthy();
    expect(errors.durationSeconds).toBeTruthy();
    expect(errors.color).toBeTruthy();
    expect(errors.endDate).toBeUndefined();
  });

  it('ignores unknown paths', () => {
    expect(fieldErrors([{ path: [] }, { path: ['nope'] }])).toEqual({});
  });
});

describe('normalizeHex', () => {
  it('accepts with or without # and uppercases', () => {
    expect(normalizeHex('#ff8800')).toBe('#FF8800');
    expect(normalizeHex('ff8800')).toBe('#FF8800');
    expect(normalizeHex('#fff')).toBeNull();
    expect(normalizeHex('zzzzzz')).toBeNull();
  });
});
