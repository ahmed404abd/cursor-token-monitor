/**
 * Shared multi-series palette for Sankey, Models mix, cache chart, etc.
 * (GitHub-green heatmap levels live in CSS.)
 */
export const SERIES_COLORS = [
  '#2dd4bf', // teal
  '#3b82f6', // blue
  '#a855f7', // purple
  '#eab308', // gold
  '#f87171', // coral
  '#22d3ee', // cyan
  '#818cf8', // indigo
  '#f472b6', // pink
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}
