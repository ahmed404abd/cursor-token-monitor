export function applyOrder(ids: string[], order: string[]): string[] {
  const set = new Set(ids);
  const ordered = order.filter((id) => set.has(id));
  const remaining = ids.filter((id) => !ordered.includes(id));
  return [...ordered, ...remaining];
}

export function validateThresholds(warning: number, critical: number): boolean {
  return (
    Number.isFinite(warning) &&
    Number.isFinite(critical) &&
    warning >= 1 &&
    critical <= 100 &&
    warning < critical
  );
}
