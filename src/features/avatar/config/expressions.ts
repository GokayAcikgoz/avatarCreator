import expressionsJson from "@shared/expressions.json";

export interface ExpressionPreset {
  id: string;
  name: string;
  /** ARKit face-unit name -> weight. Composed of several units, never a single morph. */
  morphs: Record<string, number>;
}

/**
 * Shared with the API (validation) and the Blender renderer via shared/expressions.json. Each preset
 * combines real ARKit face-unit shape keys baked onto the body and its face parts. "Talk" is a
 * static open-mouth shape, not lip-synced speech — a real morph change, documented as such.
 */
export const EXPRESSION_PRESETS: ExpressionPreset[] = expressionsJson.expressions.map((e) => ({
  id: e.id,
  name: e.name,
  morphs: e.morphs as Record<string, number>,
}));

export const EXPRESSION_IDS = EXPRESSION_PRESETS.map((e) => e.id) as [string, ...string[]];
export type ExpressionId = string;

export function getExpressionPreset(id: string | null | undefined): ExpressionPreset {
  return EXPRESSION_PRESETS.find((e) => e.id === id) ?? EXPRESSION_PRESETS[0];
}
