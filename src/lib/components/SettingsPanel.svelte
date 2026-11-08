<script lang="ts">
  import { CONFIG_LIMITS, EASINGS, FPS_OPTIONS } from '../renderer/types.ts';
  import { FONTS, FONT_IDS } from '../renderer/fonts.ts';
  import {
    RESOLUTION_OPTIONS,
    normalizeHex,
    type EditorForm,
    type FormField,
    type PreviewBackground,
  } from '../ui/editor-form.ts';

  interface Props {
    form: EditorForm;
    errors: Partial<Record<FormField, string>>;
    background: PreviewBackground;
  }

  let { form = $bindable(), errors, background = $bindable() }: Props = $props();

  const EASING_LABELS: Record<(typeof EASINGS)[number], string> = {
    linear: 'linear（一定速度）',
    smoothstep: 'smoothstep（緩やかに加減速）',
    smootherstep: 'smootherstep（より滑らかに加減速）',
  };

  // The colour picker only understands lowercase #rrggbb; fall back while the hex field is mid-edit.
  const pickerValue = $derived(normalizeHex(form.color)?.toLowerCase() ?? '#ffffff');

  function onPick(event: Event) {
    form.color = (event.currentTarget as HTMLInputElement).value.toUpperCase();
  }

  function onHexBlur() {
    const normalized = normalizeHex(form.color);
    if (normalized) form.color = normalized;
  }

  function onFontSizeRange(event: Event) {
    form.fontSize = Math.round(Number((event.currentTarget as HTMLInputElement).value));
  }

  const err = (field: FormField) => errors[field];
  const describedBy = (field: FormField) => (errors[field] ? `err-${field}` : undefined);
</script>

<section class="settings" aria-labelledby="settings-title">
  <h2 id="settings-title" class="section-title">設定</h2>

  <fieldset>
    <legend>日付</legend>
    <div class="row two">
      <div class="field">
        <label for="startDate">開始日</label>
        <input
          id="startDate"
          type="date"
          min="1000-01-01"
          max="9999-12-31"
          required
          bind:value={form.startDate}
          aria-invalid={!!err('startDate')}
          aria-describedby={describedBy('startDate')}
        />
        {#if err('startDate')}<p class="error" id="err-startDate">{err('startDate')}</p>{/if}
      </div>
      <div class="field">
        <label for="endDate">終了日</label>
        <input
          id="endDate"
          type="date"
          min="1000-01-01"
          max="9999-12-31"
          required
          bind:value={form.endDate}
          aria-invalid={!!err('endDate')}
          aria-describedby={describedBy('endDate')}
        />
        {#if err('endDate')}<p class="error" id="err-endDate">{err('endDate')}</p>{/if}
      </div>
    </div>
    <div class="field">
      <label for="dateFormat">日付表示</label>
      <input id="dateFormat" class="mono" type="text" value="YYYY.MM.DD" readonly aria-describedby="dateFormat-note" />
      <p class="hint" id="dateFormat-note">初期版では変更できません</p>
    </div>
  </fieldset>

  <fieldset>
    <legend>タイミング</legend>
    <div class="row two">
      <div class="field">
        <label for="durationSeconds">動画秒数</label>
        <div class="with-unit">
          <input
            id="durationSeconds"
            type="number"
            inputmode="decimal"
            min={CONFIG_LIMITS.durationSeconds.min}
            max={CONFIG_LIMITS.durationSeconds.max}
            step={CONFIG_LIMITS.durationSeconds.step}
            required
            bind:value={form.durationSeconds}
            aria-invalid={!!err('durationSeconds')}
            aria-describedby={describedBy('durationSeconds')}
          />
          <span class="unit" aria-hidden="true">秒</span>
        </div>
        {#if err('durationSeconds')}<p class="error" id="err-durationSeconds">{err('durationSeconds')}</p>{/if}
      </div>
      <div class="field">
        <label for="fps">FPS</label>
        <select id="fps" bind:value={form.fps} aria-invalid={!!err('fps')} aria-describedby={describedBy('fps')}>
          {#each FPS_OPTIONS as fps (fps)}
            <option value={fps}>{fps}</option>
          {/each}
        </select>
        {#if err('fps')}<p class="error" id="err-fps">{err('fps')}</p>{/if}
      </div>
    </div>
    <div class="row two">
      <div class="field">
        <label for="resolution">解像度</label>
        <select
          id="resolution"
          bind:value={form.resolution}
          aria-invalid={!!err('resolution')}
          aria-describedby={describedBy('resolution')}
        >
          {#each RESOLUTION_OPTIONS as option (option.key)}
            <option value={option.key}>{option.label}</option>
          {/each}
        </select>
        {#if err('resolution')}<p class="error" id="err-resolution">{err('resolution')}</p>{/if}
      </div>
      <div class="field">
        <label for="easing">速度曲線</label>
        <select id="easing" bind:value={form.easing} aria-invalid={!!err('easing')} aria-describedby={describedBy('easing')}>
          {#each EASINGS as easing (easing)}
            <option value={easing}>{EASING_LABELS[easing]}</option>
          {/each}
        </select>
        {#if err('easing')}<p class="error" id="err-easing">{err('easing')}</p>{/if}
      </div>
    </div>
  </fieldset>

  <fieldset>
    <legend>文字</legend>
    <div class="field">
      <label for="fontFamily">フォント</label>
      <select
        id="fontFamily"
        bind:value={form.fontFamily}
        aria-invalid={!!err('fontFamily')}
        aria-describedby={describedBy('fontFamily')}
      >
        {#each FONT_IDS as id (id)}
          <option value={id}>{FONTS[id].label}</option>
        {/each}
      </select>
      {#if err('fontFamily')}<p class="error" id="err-fontFamily">{err('fontFamily')}</p>{/if}
    </div>

    <div class="field">
      <label for="colorHex">文字色</label>
      <div class="color-row">
        <input
          id="colorPicker"
          class="swatch"
          type="color"
          value={pickerValue}
          oninput={onPick}
          aria-label="文字色（カラーピッカー）"
        />
        <input
          id="colorHex"
          class="mono"
          type="text"
          maxlength="7"
          spellcheck="false"
          autocomplete="off"
          bind:value={form.color}
          onblur={onHexBlur}
          aria-invalid={!!err('color')}
          aria-describedby={describedBy('color')}
        />
      </div>
      {#if err('color')}<p class="error" id="err-color">{err('color')}</p>{/if}
    </div>

    <div class="field">
      <label for="fontSize">フォントサイズ</label>
      <div class="slider-row">
        <input
          id="fontSizeRange"
          type="range"
          min={CONFIG_LIMITS.fontSize.min}
          max={CONFIG_LIMITS.fontSize.max}
          step="1"
          value={form.fontSize ?? CONFIG_LIMITS.fontSize.min}
          oninput={onFontSizeRange}
          aria-label="フォントサイズ（スライダー）"
          aria-valuetext={`${form.fontSize ?? '-'} px`}
        />
        <div class="with-unit narrow">
          <input
            id="fontSize"
            type="number"
            inputmode="numeric"
            min={CONFIG_LIMITS.fontSize.min}
            max={CONFIG_LIMITS.fontSize.max}
            step="1"
            required
            bind:value={form.fontSize}
            aria-invalid={!!err('fontSize')}
            aria-describedby={describedBy('fontSize')}
          />
          <span class="unit" aria-hidden="true">px</span>
        </div>
      </div>
      {#if err('fontSize')}<p class="error" id="err-fontSize">{err('fontSize')}</p>{/if}
    </div>

    <div class="row two">
      <div class="field">
        <label for="posX">位置 X <output class="mono value" for="posX">{Number(form.x).toFixed(2)}</output></label>
        <input
          id="posX"
          type="range"
          min={CONFIG_LIMITS.position.min}
          max={CONFIG_LIMITS.position.max}
          step="0.01"
          bind:value={form.x}
          aria-invalid={!!err('x')}
          aria-describedby={describedBy('x')}
        />
        {#if err('x')}<p class="error" id="err-x">{err('x')}</p>{/if}
      </div>
      <div class="field">
        <label for="posY">位置 Y <output class="mono value" for="posY">{Number(form.y).toFixed(2)}</output></label>
        <input
          id="posY"
          type="range"
          min={CONFIG_LIMITS.position.min}
          max={CONFIG_LIMITS.position.max}
          step="0.01"
          bind:value={form.y}
          aria-invalid={!!err('y')}
          aria-describedby={describedBy('y')}
        />
        {#if err('y')}<p class="error" id="err-y">{err('y')}</p>{/if}
      </div>
    </div>
  </fieldset>

  <fieldset>
    <legend>プレビュー</legend>
    <div class="field">
      <label for="previewBackground">プレビュー背景</label>
      <select id="previewBackground" bind:value={background} aria-describedby="previewBackground-note">
        <option value="checkerboard">市松模様（透過を確認）</option>
        <option value="black">黒</option>
      </select>
      <p class="hint" id="previewBackground-note">画面表示だけの設定です。書き出す動画には影響しません</p>
    </div>
  </fieldset>
</section>

<style>
  .settings {
    display: grid;
    gap: 1.25rem;
  }

  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.9rem;
    min-width: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 0.7rem;
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
  }

  legend::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--rule);
  }

  .row.two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .field {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
  }

  label {
    font-size: 0.82rem;
    color: var(--text-dim);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .value {
    color: var(--text);
    font-size: 0.8rem;
  }

  .with-unit {
    position: relative;
  }

  .with-unit input {
    width: 100%;
    padding-right: 2.2rem;
  }

  .with-unit.narrow {
    width: 6.5rem;
    flex: none;
  }

  .unit {
    position: absolute;
    right: 0.7rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    font-size: 0.78rem;
    pointer-events: none;
  }

  .color-row,
  .slider-row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }

  .color-row #colorHex {
    flex: 1;
    min-width: 0;
    text-transform: uppercase;
  }

  .slider-row input[type='range'] {
    flex: 1;
    min-width: 0;
  }

  .swatch {
    width: 2.75rem;
    height: 2.5rem;
    padding: 0.2rem;
    flex: none;
    cursor: pointer;
  }

  .hint {
    margin: 0;
    font-size: 0.74rem;
    color: var(--muted);
  }

  .error {
    margin: 0;
    font-size: 0.76rem;
    color: var(--danger);
  }

  input[readonly] {
    color: var(--muted);
    background: transparent;
    border-style: dashed;
  }

  @media (max-width: 380px) {
    .row.two {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
