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
  const progressPct = $derived(totalFrames > 1 ? (frame / (totalFrames - 1)) * 100 : 100);

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
    <div class="playhead" style:width={`${progressPct}%`} aria-hidden="true"></div>
  </div>

  <div class="readout" aria-live="off">
    <div class="readout-date">
      <span class="readout-label">現在の日付</span>
      <output class="date mono" data-testid="current-date">{currentDate}</output>
    </div>
    <dl class="readout-meta mono">
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
      <button type="button" class="icon" onclick={goToStart} aria-label="先頭へ" title="先頭へ">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
      </button>
      <button
        type="button"
        class="icon play"
        onclick={togglePlay}
        aria-label={playing ? '一時停止' : '再生'}
        aria-pressed={playing}
        title={playing ? '一時停止' : '再生'}
        data-testid="play-toggle"
      >
        {#if playing}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15L19.5 12z" /></svg>
        {/if}
      </button>
      <button type="button" class="icon" onclick={goToEnd} aria-label="末尾へ" title="末尾へ">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
      </button>
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
    gap: 0.9rem;
    min-width: 0;
  }

  .stage {
    position: relative;
    aspect-ratio: 16 / 9;
    width: 100%;
    border-radius: 6px;
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
    inset: auto 0.75rem 0.75rem;
    margin: 0;
    font-size: 0.78rem;
    color: var(--text);
    background: rgb(0 0 0 / 0.6);
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    width: fit-content;
  }

  .stage-note.error {
    color: var(--danger);
  }

  .playhead {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    background: var(--tally);
    box-shadow: 0 0 10px var(--tally);
  }

  .readout {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
    padding: 0.85rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--rule);
    border-radius: 6px;
  }

  .readout-date {
    display: grid;
    gap: 0.15rem;
  }

  .readout-label,
  dt {
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    color: var(--muted);
  }

  .date {
    font-size: clamp(1.8rem, 5vw, 2.6rem);
    line-height: 1;
    color: var(--tally);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }

  .readout-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.25rem;
    margin: 0;
  }

  .readout-meta div {
    display: grid;
    gap: 0.1rem;
  }

  dd {
    margin: 0;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }

  .transport {
    display: flex;
    align-items: center;
    gap: 0.9rem;
  }

  .buttons {
    display: flex;
    gap: 0.4rem;
    flex: none;
  }

  .icon {
    width: 2.75rem;
    height: 2.75rem;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 50%;
  }

  .icon svg {
    width: 1.15rem;
    height: 1.15rem;
    fill: currentColor;
  }

  .icon.play {
    background: var(--tally);
    border-color: var(--tally);
    color: var(--on-tally);
  }

  .icon.play:hover {
    filter: brightness(1.08);
  }

  .seek {
    flex: 1;
    min-width: 0;
    display: flex;
  }

  .seek input {
    width: 100%;
  }
</style>
