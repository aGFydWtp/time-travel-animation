<script lang="ts">
  import { onMount } from 'svelte';
  import fontUrl from '../../../assets/fonts/JetBrainsMono-Regular.woff2?url';
  import { loadFont } from '../renderer/fonts.ts';
  import { clampFrameIndex, getDateAtFrame, getTotalFrames } from '../renderer/frames.ts';
  import { renderFrame } from '../renderer/render-frame.ts';
  import type { RenderConfig } from '../renderer/types.ts';
  import type { PreviewBackground } from '../ui/editor-form.ts';
  import { PlaybackClock, formatTime, frameToSeconds, playbackStep } from '../ui/playback.ts';

  interface Props {
    /** Last valid config; the preview never draws an invalid one. */
    config: RenderConfig;
    background: PreviewBackground;
  }

  let { config, background }: Props = $props();

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
  <h2 id="preview-title" class="section-title">プレビュー</h2>

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

  <div class="readout" aria-live="off">
    <output class="date mono" data-testid="current-date" aria-label="現在の日付">{currentDate}</output>
    <dl class="readout-meta">
      <div>
        <dt>フレーム</dt>
        <dd data-testid="frame-counter">{frame} / {totalFrames - 1}</dd>
      </div>
      <div>
        <dt>時刻</dt>
        <dd data-testid="time-counter">{formatTime(frameToSeconds(frame, config))} / {formatTime(config.durationSeconds)}</dd>
      </div>
      <div>
        <dt>総フレーム</dt>
        <dd>{totalFrames} @ {config.fps}fps</dd>
      </div>
    </dl>
  </div>

  <div class="transport">
    <div class="buttons" role="group" aria-label="再生操作">
      <button type="button" onclick={goToStart}>先頭へ</button>
      <button type="button" class="play" onclick={togglePlay} aria-pressed={playing} data-testid="play-toggle">
        {playing ? '一時停止' : '再生'}
      </button>
      <button type="button" onclick={goToEnd}>末尾へ</button>
    </div>
    <label class="seek">
      <span class="visually-hidden">シーク（フレーム）</span>
      <input
        type="range"
        min="0"
        max={totalFrames - 1}
        step="1"
        value={frame}
        oninput={onSeekInput}
        aria-valuetext={`フレーム ${frame}、${currentDate}`}
        data-testid="seek"
      />
    </label>
  </div>
</section>

<style>
  .preview {
    display: grid;
    gap: 0.6rem;
    min-width: 0;
  }

  .stage {
    position: relative;
    aspect-ratio: 16 / 9;
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--rule);
  }

  /* Preview backdrops are CSS only; the canvas itself stays transparent. */
  .stage.checkerboard {
    background-color: #9aa3ad;
    background-image:
      linear-gradient(45deg, #6c757f 25%, transparent 25%),
      linear-gradient(-45deg, #6c757f 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #6c757f 75%),
      linear-gradient(-45deg, transparent 75%, #6c757f 75%);
    background-size: 24px 24px;
    background-position:
      0 0,
      0 12px,
      12px -12px,
      -12px 0;
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
    left: 0.5rem;
    bottom: 0.5rem;
    margin: 0;
    padding: 0.2rem 0.5rem;
    font-size: 0.8rem;
    background: #fff;
    border: 1px solid var(--rule);
  }

  .stage-note.error {
    color: var(--danger);
  }

  .readout {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.25rem 1.5rem;
  }

  .date {
    font-size: 1.5rem;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }

  .readout-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0;
    font-size: 0.85rem;
  }

  .readout-meta div {
    display: flex;
    gap: 0.4rem;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .transport {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  .buttons {
    display: flex;
    gap: 0.25rem;
    flex: none;
  }

  .play {
    min-width: 5.5em;
  }

  .seek {
    flex: 1;
    min-width: 10rem;
    display: flex;
  }

  .seek input {
    width: 100%;
  }
</style>
