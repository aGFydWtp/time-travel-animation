<script lang="ts">
  import { CONFIG_LIMITS, EASINGS, FPS_OPTIONS, type DateFormat } from '../renderer/types.ts';
  import { FONTS, FONT_IDS } from '../renderer/fonts.ts';
  import { RESOLUTION_OPTIONS, normalizeHex, type EditorForm, type FormField } from '../ui/editor-form.ts';
  import { EASING_LABELS } from '../ui/format.ts';
  import { rangeFill } from '../ui/range.ts';
  import DateField from './DateField.svelte';

  interface Props {
    form: EditorForm;
    errors: Partial<Record<FormField, string>>;
  }

  let { form = $bindable(), errors }: Props = $props();

  // Slash first (the default for new edits); labels are examples of the rendered date.
  const DATE_FORMAT_OPTIONS: readonly { value: DateFormat; label: string }[] = [
    { value: 'YYYY/MM/DD', label: '2026/03/06' },
    { value: 'YYYY.MM.DD', label: '2026.03.06' },
    { value: 'YYYY年MM月DD日', label: '2026年03月06日' },
  ];


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

  // Only the dates and duration are always visible; everything else lives in 詳細設定.
  const BASIC_FIELDS: readonly FormField[] = ['startDate', 'endDate', 'durationSeconds'];
  const advancedErrorCount = $derived(
    (Object.keys(errors) as FormField[]).filter((field) => errors[field] && !BASIC_FIELDS.includes(field)).length,
  );
  let advancedOpen = $state(false);
  // Never hide an invalid field inside the collapsed section.
  $effect(() => {
    if (advancedErrorCount > 0) advancedOpen = true;
  });

  const { fontSize: fontLimits, position: posLimits } = CONFIG_LIMITS;
  const err = (field: FormField) => errors[field];
  const describedBy = (field: FormField) => (errors[field] ? `err-${field}` : undefined);
</script>

<section class="settings" aria-labelledby="settings-title" id="settings">
  <h2 id="settings-title" class="visually-hidden">設定</h2>

  <div class="basic">
    <div class="field">
      <label for="startDate">開始日</label>
      <DateField
        id="startDate"
        bind:value={form.startDate}
        invalid={!!err('startDate')}
        describedBy={describedBy('startDate')}
      />
      {#if err('startDate')}<p class="error" id="err-startDate">{err('startDate')}</p>{/if}
    </div>
    <div class="field">
      <label for="endDate">終了日</label>
      <DateField
        id="endDate"
        bind:value={form.endDate}
        invalid={!!err('endDate')}
        describedBy={describedBy('endDate')}
      />
      {#if err('endDate')}<p class="error" id="err-endDate">{err('endDate')}</p>{/if}
    </div>
    <div class="field duration">
      <label for="durationSeconds">長さ</label>
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
  </div>

  <details class="advanced" bind:open={advancedOpen} data-testid="advanced-settings">
    <summary>
      <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
      詳細設定
      {#if advancedErrorCount > 0}<span class="summary-error">（エラー {advancedErrorCount} 件）</span>{/if}
    </summary>

    <div class="grid">
      <div class="field">
        <label for="dateFormat">日付の表示形式</label>
        <select
          id="dateFormat"
          bind:value={form.dateFormat}
          aria-invalid={!!err('dateFormat')}
          aria-describedby={describedBy('dateFormat')}
        >
          {#each DATE_FORMAT_OPTIONS as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        {#if err('dateFormat')}<p class="error" id="err-dateFormat">{err('dateFormat')}</p>{/if}
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
      <div class="field font-size">
        <label for="fontSize">フォントサイズ</label>
        <div class="slider-row">
          <input
            id="fontSizeRange"
            type="range"
            min={fontLimits.min}
            max={fontLimits.max}
            step="1"
            value={form.fontSize ?? fontLimits.min}
            oninput={onFontSizeRange}
            style:--pct={rangeFill(Number(form.fontSize), fontLimits.min, fontLimits.max)}
            aria-label="フォントサイズ（スライダー）"
            aria-valuetext={`${form.fontSize ?? '-'} px`}
          />
          <div class="with-unit narrow">
            <input
              id="fontSize"
              type="number"
              inputmode="numeric"
              min={fontLimits.min}
              max={fontLimits.max}
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

      <div class="field">
        <label for="posX">位置 X <output class="value" for="posX">{Number(form.x).toFixed(2)}</output></label>
        <input
          id="posX"
          type="range"
          min={posLimits.min}
          max={posLimits.max}
          step="0.01"
          bind:value={form.x}
          style:--pct={rangeFill(Number(form.x), posLimits.min, posLimits.max)}
          aria-invalid={!!err('x')}
          aria-describedby={describedBy('x')}
        />
        {#if err('x')}<p class="error" id="err-x">{err('x')}</p>{/if}
      </div>
      <div class="field">
        <label for="posY">位置 Y <output class="value" for="posY">{Number(form.y).toFixed(2)}</output></label>
        <input
          id="posY"
          type="range"
          min={posLimits.min}
          max={posLimits.max}
          step="0.01"
          bind:value={form.y}
          style:--pct={rangeFill(Number(form.y), posLimits.min, posLimits.max)}
          aria-invalid={!!err('y')}
          aria-describedby={describedBy('y')}
        />
        {#if err('y')}<p class="error" id="err-y">{err('y')}</p>{/if}
      </div>
    </div>
  </details>
</section>

<style>
  .settings {
    display: grid;
    gap: 8px;
  }

  .basic {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 7rem;
    gap: 16px;
    align-items: start;
  }

  .field {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  label {
    font-size: 13px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .value {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .error {
    margin: 0;
    font-size: 13px;
    color: var(--danger);
  }

  .advanced {
    margin-top: 16px;
  }

  summary {
    display: flex;
    align-items: center;
    gap: 4px;
    width: fit-content;
    min-height: 32px;
    list-style: none;
    cursor: pointer;
    font-size: 15px;
    font-weight: 600;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .chevron {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    transition: transform 0.15s;
  }

  .advanced[open] .chevron {
    transform: rotate(90deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }

  .summary-error {
    font-weight: 400;
    font-size: 13px;
    color: var(--danger);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    padding-top: 16px;
  }

  .with-unit {
    position: relative;
  }

  .with-unit input {
    width: 100%;
    padding-right: 2rem;
  }

  .with-unit.narrow {
    width: 6rem;
    flex: none;
  }

  .unit {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    font-size: 13px;
    pointer-events: none;
  }

  .color-row,
  .slider-row {
    display: flex;
    gap: 8px;
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
    width: 40px;
    height: 36px;
    padding: 2px;
    flex: none;
    cursor: pointer;
  }

  @media (max-width: 640px) {
    .basic {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .font-size {
      grid-column: 1 / -1;
    }
  }
</style>
