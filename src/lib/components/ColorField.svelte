<script lang="ts">
  import { normalizeHex } from '../ui/editor-form.ts';

  interface Props {
    /** #RRGGBB as typed (may be mid-edit / invalid). */
    value: string;
    /** id of the hex text input (the field's <label for>). */
    id: string;
    pickerId: string;
    pickerLabel: string;
    invalid?: boolean;
    describedBy?: string | undefined;
    /** Fallback shown by the picker while the hex text is not a valid colour. */
    fallback?: string;
  }

  let { value = $bindable(), id, pickerId, pickerLabel, invalid = false, describedBy, fallback = '#ffffff' }: Props =
    $props();

  // The colour picker only understands lowercase #rrggbb; fall back while the hex field is mid-edit.
  const pickerValue = $derived(normalizeHex(value)?.toLowerCase() ?? fallback);

  function onPick(event: Event) {
    value = (event.currentTarget as HTMLInputElement).value.toUpperCase();
  }

  function onHexBlur() {
    const normalized = normalizeHex(value);
    if (normalized) value = normalized;
  }
</script>

<div class="color-row">
  <input id={pickerId} class="swatch" type="color" value={pickerValue} oninput={onPick} aria-label={pickerLabel} />
  <input
    {id}
    class="mono hex"
    type="text"
    maxlength="7"
    spellcheck="false"
    autocomplete="off"
    bind:value
    onblur={onHexBlur}
    aria-invalid={invalid}
    aria-describedby={describedBy}
  />
</div>

<style>
  .color-row {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .hex {
    flex: 1;
    min-width: 0;
    text-transform: uppercase;
  }

  .swatch {
    width: 40px;
    height: 36px;
    padding: 2px;
    flex: none;
    cursor: pointer;
  }
</style>
