import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlJson, sqlString, sqlTimestamp } from './sql';

export interface ParticipantRecord {
  id: string;
  tenantId: string;
  connectionId: string;
  providerParticipantId: string;
  phoneE164: string | null;
  displayName: string | null;
  profileName: string | null;
  waBusinessName: string | null;
  isSelf: boolean;
  providerMetadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface ParticipantRow {
  id: string;
  tenant_id: string;
  connection_id: string;
  provider_participant_id: string;
  phone_e164: string | null;
  display_name: string | null;
  profile_name: string | null;
  wa_business_name: string | null;
  is_self: boolean;
  provider_metadata: Record<string, unknown> | string;
  created_at: string;
  updated_at: string;
}

export class PostgresParticipantRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async upsert(participant: ParticipantRecord): Promise<{ record: ParticipantRecord; created: boolean }> {
    const existing = await this.getByProviderParticipantId({
      tenantId: participant.tenantId,
      connectionId: participant.connectionId,
      providerParticipantId: participant.providerParticipantId
    });

    if (!existing) {
      await this.db.query(`
        insert into participants (
          id,
          tenant_id,
          connection_id,
          provider_participant_id,
          phone_e164,
          display_name,
          profile_name,
          wa_business_name,
          is_self,
          provider_metadata,
          created_at,
          updated_at
        ) values (
          ${sqlString(participant.id)},
          ${sqlString(participant.tenantId)},
          ${sqlString(participant.connectionId)},
          ${sqlString(participant.providerParticipantId)},
          ${sqlString(participant.phoneE164)},
          ${sqlString(participant.displayName)},
          ${sqlString(participant.profileName)},
          ${sqlString(participant.waBusinessName)},
          ${participant.isSelf ? 'true' : 'false'},
          ${sqlJson(participant.providerMetadata)},
          ${sqlTimestamp(participant.createdAt)},
          ${sqlTimestamp(participant.updatedAt)}
        )
      `);

      return { record: participant, created: true };
    }

    const next: ParticipantRecord = {
      ...existing,
      phoneE164: participant.phoneE164,
      displayName: participant.displayName,
      profileName: participant.profileName,
      waBusinessName: participant.waBusinessName,
      isSelf: participant.isSelf,
      providerMetadata: participant.providerMetadata,
      updatedAt: participant.updatedAt
    };

    await this.db.query(`
      update participants
      set phone_e164 = ${sqlString(next.phoneE164)},
          display_name = ${sqlString(next.displayName)},
          profile_name = ${sqlString(next.profileName)},
          wa_business_name = ${sqlString(next.waBusinessName)},
          is_self = ${next.isSelf ? 'true' : 'false'},
          provider_metadata = ${sqlJson(next.providerMetadata)},
          updated_at = ${sqlTimestamp(next.updatedAt)}
      where tenant_id = ${sqlString(next.tenantId)}
        and id = ${sqlString(next.id)}
    `);

    return { record: next, created: false };
  }

  async getByProviderParticipantId(input: {
    tenantId: string;
    connectionId: string;
    providerParticipantId: string;
  }): Promise<ParticipantRecord | null> {
    const rows = await this.db.query<ParticipantRow>(`
      select *
      from participants
      where tenant_id = ${sqlString(input.tenantId)}
        and connection_id = ${sqlString(input.connectionId)}
        and provider_participant_id = ${sqlString(input.providerParticipantId)}
      limit 1
    `);

    return rows[0] ? mapParticipant(rows[0]) : null;
  }

  async getById(input: { tenantId: string; id: string }): Promise<ParticipantRecord | null> {
    const rows = await this.db.query<ParticipantRow>(`
      select * from participants where tenant_id = ${sqlString(input.tenantId)} and id = ${sqlString(input.id)} limit 1
    `);
    return rows[0] ? mapParticipant(rows[0]) : null;
  }

  async listByConnection(input: { tenantId: string; connectionId: string }): Promise<ParticipantRecord[]> {
    const rows = await this.db.query<ParticipantRow>(`
      select * from participants where tenant_id = ${sqlString(input.tenantId)} and connection_id = ${sqlString(input.connectionId)} order by created_at asc
    `);
    return rows.map(mapParticipant);
  }
}

function mapParticipant(row: ParticipantRow): ParticipantRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    connectionId: row.connection_id,
    providerParticipantId: row.provider_participant_id,
    phoneE164: row.phone_e164,
    displayName: row.display_name,
    profileName: row.profile_name,
    waBusinessName: row.wa_business_name,
    isSelf: row.is_self,
    providerMetadata:
      typeof row.provider_metadata === 'string'
        ? (JSON.parse(row.provider_metadata) as Record<string, unknown>)
        : row.provider_metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}
