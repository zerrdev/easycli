/** Fewest terminal rows that leave room for a footer and some log context. */
export const MIN_DASHBOARD_ROWS = 8;

export function shouldUseDashboard(env: { isTTY: boolean; noUi: boolean; rows: number }): boolean {
  return env.isTTY && !env.noUi && env.rows >= MIN_DASHBOARD_ROWS;
}

export function shouldUseColor(env: { isTTY: boolean; noColor: boolean }): boolean {
  return env.isTTY && !env.noColor;
}
