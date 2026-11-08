<script lang="ts">
  import { onMount } from 'svelte';
  import fontUrl from '../../../assets/fonts/JetBrainsMono-Regular.woff2?url';
  import { loadFont } from '../renderer/fonts.ts';
  import { clampFrameIndex, getDateAtFrame, getTotalFrames } from '../renderer/frames.ts';
  import { renderFrame } from '../renderer/render-frame.ts';
  import type { RenderConfig } from '../renderer/types.ts';
  import type { PreviewBackground } from '../ui/editor-form.ts';
  import { PlaybackClock, formatTime, frameToSeconds, playbackStep } from '../ui/playback.ts';
  import { rangeFill } from '../ui/range.ts';

  interface Props {
    /** Last valid config; the preview never draws an invalid one. */
    config: RenderConfig;
    /** Preview-only backdrop (CSS); never affects the output. */
    background: PreviewBackground;
  }

  let { config, background = $bindable() }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let fontState: 'loading' | 'ready' | 'error' = $state('loading');
  let rawFrame = $state(0);
  let playing = $state(false);

  const totalFrames = $derived(getTotalFrames(config));
  const frame = $derived(clampFrameIndex(rawFrame, totalFrames));
  const currentDate = $derived(getDateAtFrame(frame, config));

  const clock = new PlaybackClock(() => performance.now());
  let rafId = 0;

  onMount(() => {
    // The bundled font must be loaded before any frame is drawn (spec §5.2).
    loadFont(config.fontFamily, fontUrl).then(
      () => (fontState = 'ready'),
      () => (fontState = 'error'),
    );
    return () => cancelAnimationFrame(rafId);
  });

  // Redraw whenever the config or frame changes. Canvas intrinsic size = output resolution;
  // CSS scales it. Backgrounds are CSS only — renderFrame clears to transparent.
  $effect(() => {
    if (!canvas || fontState !== 'ready') return;
    if (canvas.width !== config.width) canvas.width = config.width;
    if (canvas.height !== config.height) canvas.height = config.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderFrame(ctx, frame, config);
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

  <div class="stage" class:checkerboard={background === 'checkerboard'} class:black={background === 'black'}>
    <canvas
      bind:this={canvas}
      width={config.width}
      height={config.height}
      data-testid="preview-canvas"
      data-ready={fontState === 'ready' ? 'true' : 'false'}
      data-frame={frame}
      aria-label={`プレビュー: ${currentDate}（フレーム ${frame}）`}
    ></canvas>
    {#if fontState === 'loading'}
      <p class="stage-note">フォントを読み込み中…</p>
    {:else if fontState === 'error'}
      <p class="stage-note error" role="alert">フォントを読み込めませんでした。ページを再読み込みしてください。</p>
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
    <div class="bg" role="radiogroup" aria-label="プレビュー背景" aria-describedby="bg-note">
      <span class="bg-label" aria-hidden="true">背景</span>
      <label><input type="radio" name="preview-bg" value="checkerboard" bind:group={background} />市松</label>
      <label><input type="radio" name="preview-bg" value="black" bind:group={background} />黒</label>
      <span id="bg-note" class="visually-hidden">画面表示だけの設定です。書き出す動画には影響しません</span>
    </div>
  </div>

  <p class="readout" aria-live="off">
    <span data-testid="current-date">{currentDate}</span>
    · <span data-testid="frame-counter">{frame} / {totalFrames - 1}</span> フレーム ·
    <span data-testid="time-counter">{formatTime(frameToSeconds(frame, config))} / {formatTime(config.durationSeconds)}</span>
  </p>
</section>

<style>
  .preview {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .stage {
    position: relative;
    aspect-ratio: 16 / 9;
    width: 100%;
    overflow: hidden;
  }

  /* Preview backdrops are CSS only; the canvas itself stays transparent. */
  .stage.checkerboard {
    background-color: #80858c;
    background-image:
      linear-gradient(45deg, #737880 25%, transparent 25%),
      linear-gradient(-45deg, #737880 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #737880 75%),
      linear-gradient(-45deg, transparent 75%, #737880 75%);
    background-size: 32px 32px;
    background-position:
      0 0,
      0 16px,
      16px -16px,
      -16px 0;
  }

  .stage.black {
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
    border-radius: 4px;
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

  .bg {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    font-size: 13px;
  }

  .bg-label {
    color: var(--muted);
  }

  .bg label {
    position: relative;
    padding: 4px 8px;
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
  }

  .bg label:has(input:checked) {
    background: var(--subtle);
    color: var(--ink);
    font-weight: 600;
  }

  .bg label:has(input:focus-visible) {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  /* The native radio covers its label (keeps keyboard/AT behaviour) but is invisible. */
  .bg input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .readout {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
