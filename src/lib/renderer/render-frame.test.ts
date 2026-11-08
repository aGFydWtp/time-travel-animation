import { describe, expect, it } from 'vitest';
import { DATE_GLYPHS_FACE, fontCss, fontFaces, FONT_FILES, FONT_IDS, FONTS, getFont, isFontId, textWidthEm } from './fonts.ts';
import { layoutTabularText, renderFrame, type RenderContext } from './render-frame.ts';
import { DATE_FORMATS, DEFAULT_CONFIG, type RenderConfig } from './types.ts';

type Call = { method: string; args: unknown[]; state: Record<string, unknown> };

/** Proportional fake metrics: digits have different widths ('1' narrowest, '0' widest). */
const CHAR_WIDTHS: Record<string, number> = {
  '0': 60, '1': 30, '2': 52, '3': 50, '4': 55, '5': 50, '6': 54, '7': 48, '8': 56, '9': 54,
  '.': 20, '/': 28, '年': 96, '月': 96, '日': 96,
};
const fakeMeasure = (text: string) => ({
  width: Array.from(text).reduce((sum, c) => sum + (CHAR_WIDTHS[c] ?? 40), 0),
});

function createMockContext() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    font: '10px sans-serif',
    fillStyle: '#000000',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 0.5,
    globalCompositeOperation: 'destination-out',
  };
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args, state: { ...state } });
    };
  const ctx = {
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    fillText: record('fillText'),
    fillRect: record('fillRect'),
    fill: record('fill'),
    measureText: (text: string) => fakeMeasure(text),
  } as Record<string, unknown>;
  for (const key of Object.keys(state)) {
    Object.defineProperty(ctx, key, {
      get: () => state[key],
      set: (v) => {
        state[key] = v;
      },
    });
  }
  return { ctx: ctx as unknown as RenderContext, calls };
}

const drawn = (calls: Call[]) => calls.filter((c) => c.method === 'fillText');
const drawnText = (calls: Call[]) => drawn(calls).map((c) => c.args[0]).join('');
const DOT_CONFIG: RenderConfig = { ...DEFAULT_CONFIG, dateFormat: 'YYYY.MM.DD' };
const STACK = `"${FONTS['bundled-mono'].faces[0].family}", "${DATE_GLYPHS_FACE.family}"`;

describe('renderFrame', () => {
  it('clears the full config-sized canvas first and draws centered text without a background', () => {
    const { ctx, calls } = createMockContext();
    renderFrame(ctx, 0, DOT_CONFIG);
    const methods = calls.map((c) => c.method);
    expect(methods.slice(0, 2)).toEqual(['setTransform', 'clearRect']);
    expect(methods.slice(2).every((m) => m === 'fillText')).toBe(true);
    expect(calls[0]!.args).toEqual([1, 0, 0, 1, 0, 0]);
    expect(calls[1]!.args).toEqual([0, 0, 1920, 1080]);
    expect(methods).not.toContain('fillRect');
    expect(methods).not.toContain('fill');

    expect(drawnText(calls)).toBe('2026.03.06');
    for (const text of drawn(calls)) {
      expect(text.args[2]).toBe(540);
      expect(text.state).toMatchObject({
        font: `96px ${STACK}`,
        fillStyle: '#FFFFFF',
        textAlign: 'center',
        textBaseline: 'middle',
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
      });
    }
    // centered on x = 960: 8 digit cells of 60 + 2 dots of 20 = 520 wide
    const xs = drawn(calls).map((c) => c.args[1] as number);
    expect(xs[0]).toBe(960 - 260 + 30);
    expect(xs[9]).toBe(960 + 260 - 30);
  });

  it('uses config dimensions, position, color, size, format and the last-frame date', () => {
    const config: RenderConfig = {
      ...DEFAULT_CONFIG,
      width: 1280,
      height: 720,
      x: 0.25,
      y: 0.75,
      color: '#FF8800',
      fontSize: 48,
    };
    const { ctx, calls } = createMockContext();
    renderFrame(ctx, 449, config);
    expect(calls.find((c) => c.method === 'clearRect')!.args).toEqual([0, 0, 1280, 720]);
    expect(drawnText(calls)).toBe('2020/01/01');
    const first = drawn(calls)[0]!;
    expect(first.args[2]).toBe(540);
    expect(first.state.font).toBe(`48px ${STACK}`);
    expect(first.state.fillStyle).toBe('#FF8800');
    renderFrame(ctx, 449, { ...config, dateFormat: 'YYYY年MM月DD日' });
    expect(drawnText(calls.slice(calls.length - 13))).toBe('2020年01月01日');
  });

  it('is deterministic for the same input', () => {
    const a = createMockContext();
    const b = createMockContext();
    renderFrame(a.ctx, 123, DEFAULT_CONFIG);
    renderFrame(b.ctx, 123, DEFAULT_CONFIG);
    expect(a.calls).toEqual(b.calls);
  });
});

describe('renderFrame text state', () => {
  it('resets letterSpacing / fontKerning / fontStretch when the context supports them', () => {
    const { ctx } = createMockContext();
    const extra = ctx as unknown as Record<string, unknown>;
    Object.assign(extra, { letterSpacing: '5px', fontKerning: 'none', fontStretch: 'condensed' });
    renderFrame(ctx, 0, DEFAULT_CONFIG);
    expect(extra).toMatchObject({ letterSpacing: '0px', fontKerning: 'normal', fontStretch: 'normal' });
  });

  it('measures the digit cell once per font string (cached across frames)', () => {
    const { ctx } = createMockContext();
    const config: RenderConfig = { ...DEFAULT_CONFIG, fontSize: 77 }; // font string unique to this test
    let digitMeasures = 0;
    (ctx as unknown as Record<string, unknown>).measureText = (t: string) => {
      if (/^[0-9]$/.test(t)) digitMeasures++;
      return fakeMeasure(t);
    };
    renderFrame(ctx, 0, config);
    expect(digitMeasures).toBe(10);
    renderFrame(ctx, 200, config);
    renderFrame(ctx, 449, config);
    expect(digitMeasures).toBe(10);
  });
});

describe('textWidthEm', () => {
  it.each([
    ['bundled-mono', 'YYYY.MM.DD', 6.0],
    ['bundled-mono', 'YYYY年MM月DD日', 7.8],
    ['dela-gothic-one', 'YYYY年MM月DD日', 8 * 0.924 + 3],
    ['digital', 'YYYY年MM月DD日', 8 * 0.834 + 3],
    ['digital', 'YYYY/MM/DD', 8 * 0.834 + 2 * 0.521],
    ['noto-serif-jp', 'YYYY.MM.DD', 8 * 0.562 + 2 * 0.327],
  ] as const)('%s / %s = %f em', (id, format, em) => {
    expect(textWidthEm(id, format)).toBeCloseTo(em, 6);
  });

  it('is defined for every font and format (all glyphs come from bundled faces)', () => {
    for (const id of FONT_IDS) {
      for (const f of DATE_FORMATS) {
        const w = textWidthEm(id, f);
        expect(w, `${id} ${f}`).toBeGreaterThan(3.5);
        expect(w, `${id} ${f}`).toBeLessThan(11);
      }
    }
  });
});

describe('layoutTabularText', () => {
  const ctx = { measureText: fakeMeasure } as unknown as Pick<CanvasRenderingContext2D, 'measureText'>;

  it.each([
    ['2026/03/06', '2011/11/11', '1999/08/88'],
    ['2026.03.06', '1111.11.11', '8888.00.00'],
    ['2026年03月06日', '2011年11月11日', '1000年01月01日'],
  ])('total width and separator positions are identical for %s / %s / %s', (...texts) => {
    const layouts = texts.map((t) => layoutTabularText(ctx, t, 500));
    const widths = layouts.map((l) => l.totalWidth);
    expect(new Set(widths).size).toBe(1);
    for (const l of layouts) {
      expect(l.digitCellWidth).toBe(60);
      expect(l.glyphs[0]!.x - l.glyphs[0]!.width / 2).toBeCloseTo(500 - l.totalWidth / 2);
      const last = l.glyphs.at(-1)!;
      expect(last.x + last.width / 2).toBeCloseTo(500 + l.totalWidth / 2);
    }
    // every glyph center (incl. separators) stays put while the digits change
    const xs = layouts.map((l) => l.glyphs.map((g) => g.x));
    expect(xs[1]).toEqual(xs[0]);
    expect(xs[2]).toEqual(xs[0]);
  });

  it('digits take the widest digit cell; separators and kanji their natural width', () => {
    const l = layoutTabularText(ctx, '2011年11月11日', 0);
    expect(l.glyphs.map((g) => g.width)).toEqual([60, 60, 60, 60, 96, 60, 60, 96, 60, 60, 96]);
    expect(l.totalWidth).toBe(8 * 60 + 3 * 96);
    expect(layoutTabularText(ctx, '2011/11/11', 0).totalWidth).toBe(8 * 60 + 2 * 28);
  });
});

describe('fonts', () => {
  it('keeps the legacy bundled-mono id (JetBrains Mono + Noto Sans JP glyph face)', () => {
    expect(isFontId('bundled-mono')).toBe(true);
    expect(isFontId('toString')).toBe(false);
    expect(getFont('bundled-mono').faces.map((f) => f.file)).toEqual([
      'JetBrainsMono-Regular.woff2',
      'NotoSansJP-DateGlyphs.woff2',
    ]);
    expect(() => getFont('nope')).toThrow(RangeError);
  });

  it('registry: 8 fonts, unique DCS-prefixed families, woff2 files, labels', () => {
    expect(FONT_IDS).toEqual([
      'bundled-mono', 'noto-sans-jp', 'noto-serif-jp', 'zen-maru-gothic',
      'klee-one', 'dela-gothic-one', 'dotgothic16', 'digital',
    ]);
    const families = new Map<string, string>();
    for (const id of FONT_IDS) {
      const font = getFont(id);
      expect(font.label.length).toBeGreaterThan(0);
      expect(font.faces.length).toBeGreaterThan(0);
      for (const face of font.faces) {
        expect(face.family).toMatch(/^DCS /);
        expect(face.file).toMatch(/^[A-Za-z0-9-]+\.woff2$/);
        // one family name <-> one file
        expect(families.get(face.family) ?? face.file).toBe(face.file);
        families.set(face.family, face.file);
      }
    }
    expect(new Set(FONT_FILES)).toEqual(new Set(families.values()));
    expect(FONT_FILES.length).toBe(8);
  });

  it('fonts without kanji glyphs fall back to the bundled Noto Sans JP face only', () => {
    expect(fontFaces('bundled-mono').at(-1)).toBe(DATE_GLYPHS_FACE);
    expect(fontFaces('digital').at(-1)).toBe(DATE_GLYPHS_FACE);
    expect(fontFaces('noto-serif-jp')).toHaveLength(1);
  });

  it.each(FONT_IDS)('fontCss(%s) names only quoted bundled families (no generic fallback)', (id) => {
    const css = fontCss({ fontFamily: id, fontSize: 96 });
    const expected = getFont(id).faces.map((f) => `"${f.family}"`).join(', ');
    expect(css).toBe(`96px ${expected}`);
    expect(css).not.toMatch(/\b(monospace|sans-serif|serif|system-ui|cursive|fantasy)\b(?!")/);
    expect(css.replace(/"[^"]*"/g, '')).toMatch(/^96px (, )*$/);
  });

  it('fontCss for the default config is the two-family stack', () => {
    expect(fontCss(DEFAULT_CONFIG)).toBe('96px "DCS JetBrains Mono", "DCS Noto Sans JP"');
  });
});
