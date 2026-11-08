import { describe, expect, it } from 'vitest';
import { fontCss, FONTS, getFont, isFontId } from './fonts.ts';
import { renderFrame, type RenderContext } from './render-frame.ts';
import { DEFAULT_CONFIG, type RenderConfig } from './types.ts';

type Call = { method: string; args: unknown[]; state: Record<string, unknown> };

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

describe('renderFrame', () => {
  it('clears the full config-sized canvas first and draws centered text without a background', () => {
    const { ctx, calls } = createMockContext();
    renderFrame(ctx, 0, DEFAULT_CONFIG);

    const methods = calls.map((c) => c.method);
    expect(methods).toEqual(['setTransform', 'clearRect', 'fillText']);
    expect(calls[0]!.args).toEqual([1, 0, 0, 1, 0, 0]);
    expect(calls[1]!.args).toEqual([0, 0, 1920, 1080]);
    expect(methods).not.toContain('fillRect');
    expect(methods).not.toContain('fill');

    const text = calls[2]!;
    expect(text.args).toEqual(['2026.03.06', 960, 540]);
    expect(text.state).toMatchObject({
      font: `96px "${FONTS['bundled-mono'].family}"`,
      fillStyle: '#FFFFFF',
      textAlign: 'center',
      textBaseline: 'middle',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
    });
  });

  it('uses config dimensions, position, color, size and the last-frame date', () => {
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
    const text = calls.find((c) => c.method === 'fillText')!;
    expect(text.args).toEqual(['2020.01.01', 320, 540]);
    expect(text.state.font).toBe(`48px "${FONTS['bundled-mono'].family}"`);
    expect(text.state.fillStyle).toBe('#FF8800');
  });

  it('is deterministic for the same input', () => {
    const a = createMockContext();
    const b = createMockContext();
    renderFrame(a.ctx, 123, DEFAULT_CONFIG);
    renderFrame(b.ctx, 123, DEFAULT_CONFIG);
    expect(a.calls).toEqual(b.calls);
  });
});

describe('fonts', () => {
  it('registry has the bundled mono font with a woff2 file', () => {
    expect(isFontId('bundled-mono')).toBe(true);
    expect(isFontId('toString')).toBe(false);
    expect(getFont('bundled-mono').file).toBe('JetBrainsMono-Regular.woff2');
    expect(() => getFont('nope')).toThrow(RangeError);
  });

  it('fontCss names only the quoted bundled family (no generic fallback)', () => {
    const css = fontCss(DEFAULT_CONFIG);
    expect(css).toBe(`96px "${FONTS['bundled-mono'].family}"`);
    expect(css).not.toMatch(/monospace|sans-serif|serif|,/);
  });
});
