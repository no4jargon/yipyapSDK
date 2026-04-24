import { PGlite } from '@electric-sql/pglite';

export interface PostgresTestHarness {
  query<T>(sql: string): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function createPostgresTestHarness(): Promise<PostgresTestHarness> {
  const db = new PGlite();

  return {
    async query<T>(sql: string): Promise<T[]> {
      const result = await db.query<T>(sql);
      return result.rows;
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
    async close(): Promise<void> {
      await db.close();
    }
  };
}
