import { describe, expect, it } from 'vitest';
import { safeParseRenderConfig } from '../renderer/schema.ts';
import { DEFAULT_CONFIG } from '../renderer/types.ts';
import {
  BACKGROUND_CHOICES,
  DEFAULT_CUSTOM_BACKGROUND,
  backgroundChoice,
  backgroundValue,
  defaultForm,
  fieldErrors,
  formFromConfig,
  formToConfigInput,
  normalizeHex,
} from './editor-form.ts';

describe('form <-> config', () => {
  it('default form parses to DEFAULT_CONFIG', () => {
    const parsed = safeParseRenderConfig(formToConfigInput(defaultForm()));
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips a non-default config (load into editor)', () => {
    const config = {
      ...DEFAULT_CONFIG,
      width: 1280 as const,
      height: 720 as const,
      fps: 24 as const,
      x: 0.2,
      dateFormat: 'YYYY年MM月DD日' as const,
      fontFamily: 'noto-serif-jp',
    };
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

  it('maps an unknown date format to its field', () => {
    const parsed = safeParseRenderConfig(formToConfigInput({ ...defaultForm(), dateFormat: 'DD/MM/YYYY' }));
    expect(fieldErrors(parsed.error?.issues)).toHaveProperty('dateFormat');
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

describe('背景 (background)', () => {
  it('offers the five choices in order', () => {
    expect(BACKGROUND_CHOICES.map((c) => c.label)).toEqual(['透過（MOV）', '黒', '白', 'グリーン', '好きな色']);
  });

  it('selects the preset whose hex matches (any case), otherwise 好きな色', () => {
    expect(backgroundChoice('transparent')).toBe('transparent');
    expect(backgroundChoice('#000000')).toBe('black');
    expect(backgroundChoice('#ffffff')).toBe('white');
    expect(backgroundChoice('00FF00')).toBe('green');
    expect(backgroundChoice('#123456')).toBe('custom');
    expect(backgroundChoice('#12')).toBe('custom'); // mid-edit stays on 好きな色
    expect(backgroundChoice(DEFAULT_CUSTOM_BACKGROUND)).toBe('custom');
  });

  it('a choice sets its value; 好きな色 restores the remembered colour', () => {
    expect(backgroundValue('transparent', '#123456')).toBe('transparent');
    expect(backgroundValue('green', '#123456')).toBe('#00FF00');
    expect(backgroundValue('custom', '#123456')).toBe('#123456');
  });

  it('round-trips transparent, preset and custom backgrounds through the form', () => {
    for (const background of ['transparent', '#00FF00', '#12ABEF'] as const) {
      const config = { ...DEFAULT_CONFIG, background };
      expect(formFromConfig(config).background).toBe(background);
      expect(safeParseRenderConfig(formToConfigInput(formFromConfig(config))).data).toEqual(config);
    }
  });

  it('a config without background (old job) loads as transparent', () => {
    const { background: _b, ...legacy } = DEFAULT_CONFIG;
    expect(formFromConfig(legacy as typeof DEFAULT_CONFIG).background).toBe('transparent');
  });

  it('an invalid custom colour is reported on the background field', () => {
    const parsed = safeParseRenderConfig(formToConfigInput({ ...defaultForm(), background: '#12' }));
    expect(parsed.success).toBe(false);
    expect(Object.keys(fieldErrors(parsed.error?.issues))).toEqual(['background']);
  });
});
