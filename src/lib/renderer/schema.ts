import { z } from 'zod';
import { isValidIsoDate } from './calendar.ts';
import { isFontId } from './fonts.ts';
import {
  CONFIG_LIMITS,
  DATE_FORMATS,
  DEFAULT_BACKGROUND,
  EASINGS,
  LEGACY_DATE_FORMAT,
  RESOLUTIONS,
  type Background,
  type RenderConfig,
} from './types.ts';

const DURATION_STEP_TOLERANCE = 1e-6;

function isTenthMultiple(value: number): boolean {
  const scaled = value * 10;
  return Math.abs(scaled - Math.round(scaled)) < DURATION_STEP_TOLERANCE;
}

const hexColor = (message: string) =>
  z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, { message })
    .transform((c) => c.toUpperCase() as `#${string}`);

const isoDate = z.string().refine(isValidIsoDate, {
  message: 'Invalid date: expected an existing YYYY-MM-DD date between 1000 and 9999',
});

export const renderConfigSchema = z
  .strictObject({
    startDate: isoDate,
    endDate: isoDate,
    durationSeconds: z
      .number()
      .min(CONFIG_LIMITS.durationSeconds.min)
      .max(CONFIG_LIMITS.durationSeconds.max)
      .refine(isTenthMultiple, { message: 'durationSeconds must be a multiple of 0.1' }),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
    width: z.union([z.literal(1280), z.literal(1920)]),
    height: z.union([z.literal(720), z.literal(1080)]),
    easing: z.enum(EASINGS),
    // Optional on input for back-compat (old stored jobs / old clients rendered dots); always
    // present in the parsed output, so it is part of the canonical string and the hash.
    dateFormat: z.enum(DATE_FORMATS).default(LEGACY_DATE_FORMAT),
    fontFamily: z.string().refine(isFontId, { message: 'Unknown font' }),
    fontSize: z.number().int().min(CONFIG_LIMITS.fontSize.min).max(CONFIG_LIMITS.fontSize.max),
    color: hexColor('color must be #RRGGBB'),
    // Optional on input for back-compat (old stored jobs / old clients were transparent). Unlike
    // dateFormat, 'transparent' is left OUT of the canonical string so existing hashes don't change.
    background: z
      .union([z.literal('transparent'), hexColor("background must be 'transparent' or #RRGGBB")])
      .default(DEFAULT_BACKGROUND),
    x: z.number().min(CONFIG_LIMITS.position.min).max(CONFIG_LIMITS.position.max),
    y: z.number().min(CONFIG_LIMITS.position.min).max(CONFIG_LIMITS.position.max),
  })
  .superRefine((c, ctx) => {
    if (!RESOLUTIONS.some((r) => r.width === c.width && r.height === c.height)) {
      ctx.addIssue({
        code: 'custom',
        path: ['height'],
        message: 'Resolution must be 1280x720 or 1920x1080',
      });
    }
  })
  .transform(
    (c): RenderConfig => ({
      ...c,
      // snap to the 0.1 grid so equivalent inputs hash identically
      durationSeconds: Math.round(c.durationSeconds * 10) / 10,
    }),
  );

export type RenderConfigInput = z.input<typeof renderConfigSchema>;

/** Validate and normalize unknown input. Throws ZodError on invalid input. */
export function parseRenderConfig(input: unknown): RenderConfig {
  return renderConfigSchema.parse(input);
}

export function safeParseRenderConfig(input: unknown) {
  return renderConfigSchema.safeParse(input);
}

/** Validate + normalize (uppercase color, duration snapped to 0.1). Throws on invalid config. */
export function normalizeConfig(config: unknown): RenderConfig {
  return renderConfigSchema.parse(config);
}

/** True for the transparent (alpha MOV) background; also for configs stored before the option existed. */
export function isTransparentBackground(config: { background?: Background | undefined }): boolean {
  return (config.background ?? DEFAULT_BACKGROUND) === 'transparent';
}

/**
 * The normalized config with keys sorted alphabetically, WITHOUT `background` when it is
 * 'transparent' (the default), so configs from before the option keep their exact canonical
 * string and hash. Also the form handed to the render container (an older image accepts it).
 */
export function compactConfig(config: unknown): Record<string, unknown> {
  const normalized = normalizeConfig(config) as unknown as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(normalized).sort()) {
    if (key === 'background' && normalized[key] === DEFAULT_BACKGROUND) continue;
    sorted[key] = normalized[key];
  }
  return sorted;
}

/** Deterministic JSON of compactConfig(config). */
export function canonicalConfigString(config: unknown): string {
  return JSON.stringify(compactConfig(config));
}

/** SHA-256 (lowercase hex) of canonicalConfigString(config). Uses Web Crypto. */
export async function hashConfig(config: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalConfigString(config));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
