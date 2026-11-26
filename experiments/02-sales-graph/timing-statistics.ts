export function quantile(values: readonly number[], fraction: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}
export function describe(values: readonly number[]) {
  return { median: quantile(values, .5), q1: quantile(values, .25), q3: quantile(values, .75) };
}

export function bootstrapMedianInterval(values: readonly number[], next: () => number): [number, number] | undefined {
  if (values.length < 12) return;
  const bootstrap = Array.from({ length: 2_000 }, () =>
    quantile(values.map(() => values[Math.floor(next() * values.length)]), .5));
  return [quantile(bootstrap, .025), quantile(bootstrap, .975)];
}
