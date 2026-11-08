<script lang="ts">
  import { onMount } from 'svelte';
  import { isoToDisplay, normalizeDateInput, parseDateInput } from '../ui/date-input.ts';

  interface Props {
    id: string;
    /** ISO `YYYY-MM-DD` when valid; otherwise the raw text, so validation reports it. */
    value: string;
    invalid: boolean;
    describedBy?: string;
  }

  let { id, value = $bindable(), invalid, describedBy }: Props = $props();

  let text = $state(isoToDisplay(value));
  let picker: HTMLInputElement | undefined = $state();
  let field: HTMLInputElement | undefined = $state();
  /**
   * How the calendar opens:
   * - 'touch': the transparent native date input sits on the icon and is tapped directly.
   *   Mobile Safari ignores `showPicker()` on a hidden input, but a real tap opens its picker.
   * - 'button': a mouse/keyboard button calls `showPicker()` on the hidden native input.
   * - 'none': neither works, so only the text field is offered.
   */
  let pickMode: 'none' | 'button' | 'touch' = $state('none');

  onMount(() => {
    if (window.matchMedia('(pointer: coarse)').matches) pickMode = 'touch';
    else if (typeof HTMLInputElement.prototype.showPicker === 'function') pickMode = 'button';
  });

  const toValue = (t: string) => parseDateInput(t) ?? normalizeDateInput(t);

  // External changes (e.g. loading a job's settings) replace the text; our own edits don't loop back.
  $effect(() => {
    const next = value;
    if (toValue(text) !== next) text = isoToDisplay(next);
  });

  function onInput(event: Event) {
    // Leave text alone while a Japanese IME is composing; normalize once it commits.
    if ((event as InputEvent).isComposing) return;
    commit(event.currentTarget as HTMLInputElement);
  }

  function commit(input: HTMLInputElement) {
    const normalized = normalizeDateInput(input.value);
    if (normalized !== input.value) input.value = normalized;
    text = normalized;
    value = toValue(normalized);
  }

  function onBlur() {
    const iso = parseDateInput(text);
    if (iso) text = isoToDisplay(iso);
  }

  function openPicker() {
    if (!picker) return;
    try {
      picker.showPicker();
    } catch {
      // Picker refused (e.g. not allowed right now): keep the user on the text field.
      field?.focus();
    }
  }

  function onPick(event: Event) {
    const iso = (event.currentTarget as HTMLInputElement).value;
    if (!parseDateInput(iso)) return;
    value = iso;
    text = isoToDisplay(iso);
  }
</script>

<div class="date-field">
  <input
    bind:this={field}
    {id}
    type="text"
    inputmode="numeric"
    autocomplete="off"
    placeholder="2026/03/06"
    maxlength="10"
    value={text}
    oninput={onInput}
    oncompositionend={(event) => commit(event.currentTarget)}
    onblur={onBlur}
    required
    aria-invalid={invalid}
    aria-describedby={describedBy}
  />
  {#if pickMode === 'button'}
    <button type="button" class="calendar" onclick={openPicker} aria-label="カレンダーから選ぶ" title="カレンダーから選ぶ">
      {@render calendarIcon()}
    </button>
  {:else if pickMode === 'touch'}
    <span class="calendar" aria-hidden="true">{@render calendarIcon()}</span>
  {/if}
  <!-- Native picker only for its popup calendar; the text input is the real field. -->
  <input
    bind:this={picker}
    class="native"
    class:touch={pickMode === 'touch'}
    type="date"
    tabindex="-1"
    aria-label={pickMode === 'touch' ? 'カレンダーから選ぶ' : undefined}
    aria-hidden={pickMode === 'touch' ? undefined : 'true'}
    min="1000-01-01"
    max="9999-12-31"
    value={parseDateInput(text) ?? ''}
    onchange={onPick}
  />
</div>

{#snippet calendarIcon()}
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
{/snippet}

<style>
  .date-field {
    position: relative;
  }

  .date-field input[type='text'] {
    padding-right: 40px;
    font-variant-numeric: tabular-nums;
  }

  .calendar {
    position: absolute;
    top: 50%;
    right: 2px;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    min-height: 32px;
    padding: 0;
    background: none;
    color: var(--muted);
  }

  button.calendar:hover:not(:disabled) {
    background: var(--subtle);
    color: var(--ink);
  }

  .calendar svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  /*
   * Kept in the layout (showPicker needs a rendered element) but invisible, under the icon.
   * `.date-field input.native` must outrank the global `input:not(...):not(...):not(...)` rule
   * (width 100%, min-height, padding), or the native input stretches over the text field.
   */
  .date-field input.native {
    position: absolute;
    right: 2px;
    bottom: 0;
    width: 32px;
    min-width: 0;
    height: 1px;
    min-height: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
  }

  /* Touch: the invisible native input covers only the icon slot so a tap opens the OS date picker. */
  .date-field input.native.touch {
    top: 0;
    right: 0;
    bottom: 0;
    width: 40px; /* = the text field's padding-right */
    height: auto;
    font-size: 16px; /* below 16px iOS zooms the page on focus */
    appearance: none;
    -webkit-appearance: none;
    background: none;
    pointer-events: auto;
    cursor: pointer;
  }

  .date-field:has(.native.touch:active) .calendar {
    background: var(--subtle);
    color: var(--ink);
  }
</style>
