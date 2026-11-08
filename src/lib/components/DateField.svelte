<script lang="ts">
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

  const toValue = (t: string) => parseDateInput(t) ?? normalizeDateInput(t);

  // External changes (e.g. loading a job's settings) replace the text; our own edits don't loop back.
  $effect(() => {
    const next = value;
    if (toValue(text) !== next) text = isoToDisplay(next);
  });

  function onInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
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
      picker.focus();
      picker.click();
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
    {id}
    type="text"
    inputmode="numeric"
    autocomplete="off"
    placeholder="2026/03/06"
    maxlength="10"
    value={text}
    oninput={onInput}
    onblur={onBlur}
    required
    aria-invalid={invalid}
    aria-describedby={describedBy}
  />
  <button type="button" class="calendar" onclick={openPicker} aria-label="カレンダーから選ぶ" title="カレンダーから選ぶ">
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </svg>
  </button>
  <!-- Native picker only for its popup calendar; the text input is the real field. -->
  <input
    bind:this={picker}
    class="native"
    type="date"
    tabindex="-1"
    aria-hidden="true"
    min="1000-01-01"
    max="9999-12-31"
    value={parseDateInput(text) ?? ''}
    onchange={onPick}
  />
</div>

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

  .calendar:hover:not(:disabled) {
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

  /* Kept in the layout (showPicker needs a rendered element) but invisible, under the icon. */
  .native {
    position: absolute;
    right: 2px;
    bottom: 0;
    width: 32px;
    height: 1px;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
  }
</style>
