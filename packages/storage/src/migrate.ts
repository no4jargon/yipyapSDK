import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import {
  migrationName as migration0001Name,
  migrationSql as migration0001Sql
} from '../../../infra/migrations/0001_initial';
import {
  migrationName as migration0002Name,
  migrationSql as migration0002Sql
} from '../../../infra/migrations/0002_event_log';
import {
  migrationName as migration0003Name,
  migrationSql as migration0003Sql
} from '../../../infra/migrations/0003_conversations_and_participants';
import {
  migrationName as migration0004Name,
  migrationSql as migration0004Sql
} from '../../../infra/migrations/0004_messages_attachments_receipts';
import {
  migrationName as migration0005Name,
  migrationSql as migration0005Sql
} from '../../../infra/migrations/0005_history_imports';
import {
  migrationName as migration0006Name,
  migrationSql as migration0006Sql
} from '../../../infra/migrations/0006_clusters';
import {
  migrationName as migration0007Name,
  migrationSql as migration0007Sql
} from '../../../infra/migrations/0007_metadata';
import {
  migrationName as migration0008Name,
  migrationSql as migration0008Sql
} from '../../../infra/migrations/0008_mappings_and_cursors';
import {
  migrationName as migration0009Name,
  migrationSql as migration0009Sql
} from '../../../infra/migrations/0009_deletion_records';
import {
  migrationName as migration0010Name,
  migrationSql as migration0010Sql
} from '../../../infra/migrations/0010_inbox_projection_and_sync_state';
import { sqlString } from './sql';

const migrations = [
  { name: migration0001Name, sql: migration0001Sql },
  { name: migration0002Name, sql: migration0002Sql },
  { name: migration0003Name, sql: migration0003Sql },
  { name: migration0004Name, sql: migration0004Sql },
  { name: migration0005Name, sql: migration0005Sql },
  { name: migration0006Name, sql: migration0006Sql },
  { name: migration0007Name, sql: migration0007Sql },
  { name: migration0008Name, sql: migration0008Sql },
  { name: migration0009Name, sql: migration0009Sql },
  { name: migration0010Name, sql: migration0010Sql }
];

export async function runMigrations(db: PostgresTestHarness): Promise<void> {
  await db.exec(migration0001Sql);

  for (const migration of migrations) {
    const applied = await db.query<{ name: string }>(`
      select name
      from schema_migrations
      where name = ${sqlString(migration.name)}
      limit 1
    `);

    if (applied.length > 0) {
      continue;
    }

    if (migration.name !== migration0001Name) {
      await db.exec(migration.sql);
    }

    await db.query(`
      insert into schema_migrations (name)
      values (${sqlString(migration.name)})
      on conflict (name) do nothing
    `);
  }
}
