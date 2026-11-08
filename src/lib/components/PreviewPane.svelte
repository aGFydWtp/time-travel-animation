<script lang="ts">
  import { onMount } from 'svelte';
  import { loadFont } from '../renderer/fonts.ts';
  import { clampFrameIndex, getDateAtFrame, getTotalFrames } from '../renderer/frames.ts';
  import { renderFrame } from '../renderer/render-frame.ts';
  import type { RenderConfig } from '../renderer/types.ts';
  import { PlaybackClock, formatTime, frameToSeconds, playbackStep } from '../ui/playback.ts';
  import { rangeFill } from '../ui/range.ts';

  interface Props {
    /** Last valid config; the preview never draws an invalid one. */
    config: RenderConfig;
  }

  let { config }: Props = $props();

  // Every bundled font file as a URL, keyed by file name (FONTS[*].faces[*].file).
  const FONT_URLS = Object.fromEntries(
    Object.entries(
      import.meta.glob<string>('../../../assets/fonts/*.woff2', { query: '?url', eager: true, import: 'default' }),
    ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
  );
  const resolveFontUrl = (file: string) => FONT_URLS[file] ?? '';

  let canvas: HTMLCanvasElement | undefined = $state();
  /** Font id that is loaded and used for drawing; lags behind config.fontFamily while a new font loads. */
  let drawnFont: string | null = $state(null);
  let fontError = $state(false);
  const fontState = $derived(drawnFont === null ? (fontError ? 'error' : 'loading') : 'ready');
  // Keep drawing with the previous font until the newly chosen one has loaded.
  const drawConfig = $derived(
    drawnFont === null || drawnFont === config.fontFamily ? config : { ...config, fontFamily: drawnFont },
  );
  let rawFrame = $state(0);
  let playing = $state(false);

  const totalFrames = $derived(getTotalFrames(config));
  const frame = $derived(clampFrameIndex(rawFrame, totalFrames));
  const currentDate = $derived(getDateAtFrame(frame, config));

  const clock = new PlaybackClock(() => performance.now());
  let rafId = 0;

  onMount(() => () => cancelAnimationFrame(rafId));

  // Fonts load lazily, per chosen font, and must be loaded before a frame uses them (spec §5.2).
  $effect(() => {
    const id = config.fontFamily;
    if (id === drawnFont) return;
    let cancelled = false;
    fontError = false;
    loadFont(id, resolveFontUrl).then(
      () => {
        if (!cancelled) drawnFont = id;
      },
      () => {
        if (!cancelled) fontError = true;
      },
    );
    return () => {
      cancelled = true;
    };
  });

  // Redraw whenever the config or frame changes. Canvas intrinsic size = output resolution;
  // CSS scales it. Backgrounds are CSS only — renderFrame clears to transparent.
  $effect(() => {
    if (!canvas || drawnFont === null) return;
    const cfg = drawConfig;
    if (canvas.width !== cfg.width) canvas.width = cfg.width;
    if (canvas.height !== cfg.height) canvas.height = cfg.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderFrame(ctx, frame, cfg);
  });

  function tick() {
    const step = playbackStep(clock.elapsed(), config);
    rawFrame = step.frame;
    if (step.ended) {
      stop();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    // Restart from the top when play is pressed on the last frame.
    const from = frame >= totalFrames - 1 ? 0 : frame;
    rawFrame = from;
    clock.seek(frameToSeconds(from, config));
    clock.play();
    playing = true;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(rafId);
    clock.pause();
    playing = false;
  }

  function togglePlay() {
    if (playing) stop();
    else play();
  }

  function seekTo(target: number) {
    const f = clampFrameIndex(target, totalFrames);
    rawFrame = f;
    clock.seek(frameToSeconds(f, config));
  }

  function goToStart() {
    seekTo(0);
  }

  function goToEnd() {
    stop();
    seekTo(totalFrames - 1);
  }

  function onSeekInput(event: Event) {
    seekTo(Number((event.currentTarget as HTMLInputElement).value));
  }
</script>

<section class="preview" aria-labelledby="preview-title">
  <h2 id="preview-title" class="visually-hidden">プレビュー</h2>

  <div class="stage">
    <canvas
      bind:this={canvas}
      width={config.width}
      height={config.height}
      data-testid="preview-canvas"
      data-ready={fontState === 'ready' ? 'true' : 'false'}
      data-font={drawnFont}
      data-frame={frame}
      data-date={currentDate}
      aria-label={`プレビュー: ${currentDate}（フレーム ${frame}）`}
    ></canvas>
    {#if fontError}
      <p class="stage-note error" role="alert">フォントを読み込めませんでした。ページを再読み込みしてください。</p>
    {:else if drawnFont !== config.fontFamily}
      <p class="stage-note">フォントを読み込み中…</p>
    {/if}
  </div>

  <div class="transport">
    <div class="buttons" role="group" aria-label="再生操作">
      <button type="button" class="icon" onclick={goToStart} aria-label="先頭へ" title="先頭へ">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h2v10H3zM13.5 2.5v11L6 8z" /></svg>
      </button>
      <button
        type="button"
        class="icon play"
        onclick={togglePlay}
        aria-label={playing ? '停止' : '再生'}
        title={playing ? '停止' : '再生'}
        data-testid="play-toggle"
      >
        {#if playing}
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" /></svg>
        {:else}
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5v11l9-5.5z" /></svg>
        {/if}
      </button>
      <button type="button" class="icon" onclick={goToEnd} aria-label="末尾へ" title="末尾へ">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 3h2v10h-2zM2.5 2.5v11L10 8z" /></svg>
      </button>
    </div>
    <input
      class="seek"
      type="range"
      min="0"
      max={totalFrames - 1}
      step="1"
      value={frame}
      oninput={onSeekInput}
      style:--pct={rangeFill(frame, 0, totalFrames - 1)}
      aria-label="シーク（フレーム）"
      aria-valuetext={`フレーム ${frame}、${currentDate}`}
      data-testid="seek"
    />
  </div>

  <p class="readout" aria-live="off">
    <span data-testid="time-counter">{formatTime(frameToSeconds(frame, config))} / {formatTime(config.durationSeconds)}</span>
  </p>
</section>

<style>
  .preview {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  /* Black backdrop (as in the MP4) is CSS only; the canvas itself stays transparent. */
  .stage {
    position: relative;
    aspect-ratio: 16 / 9;
    width: 100%;
    overflow: hidden;
    background: #000;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .stage-note {
    position: absolute;
    left: 8px;
    bottom: 8px;
    margin: 0;
    padding: 4px 8px;
    font-size: 13px;
    background: #fff;
  }

  .stage-note.error {
    color: var(--danger);
  }

  .transport {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
  }

  .buttons {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    min-height: 32px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--ink);
  }

  .icon:hover:not(:disabled) {
    background: var(--hover);
  }

  .icon svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  .icon.play {
    width: 36px;
    height: 36px;
  }

  .icon.play svg {
    width: 18px;
    height: 18px;
  }

  .seek {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .readout {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
