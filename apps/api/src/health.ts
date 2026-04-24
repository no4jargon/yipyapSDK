export interface HealthCheckResult {
  ok: boolean;
}

export async function getHealthSnapshot(input: {
  checks: Record<string, () => Promise<HealthCheckResult>>;
}): Promise<{ ok: boolean; checks: Record<string, HealthCheckResult> }> {
  const entries = await Promise.all(
    Object.entries(input.checks).map(async ([name, check]) => [name, await check()] as const)
  );
  const checks = Object.fromEntries(entries) as Record<string, HealthCheckResult>;
  return {
    ok: Object.values(checks).every((check) => check.ok),
    checks
  };
}
