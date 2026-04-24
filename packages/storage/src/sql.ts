export function sqlString(value: string | null): string {
  if (value === null) {
    return 'null';
  }

  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlTimestamp(value: Date | null): string {
  if (value === null) {
    return 'null';
  }

  return sqlString(value.toISOString());
}

export function sqlJson(value: unknown): string {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}
