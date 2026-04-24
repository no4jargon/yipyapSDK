import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlJson, sqlString, sqlTimestamp } from './sql';

export interface ConversationMembershipRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  participantId: string;
  membershipState: 'active' | 'left' | 'removed' | 'unknown';
  observedAt: Date;
  providerMetadata: Record<string, unknown>;
}

export interface ConversationParticipantSnapshot {
  participantId: string;
  providerParticipantId: string;
  displayName: string | null;
  phoneE164: string | null;
  isSelf: boolean;
  membershipState: ConversationMembershipRecord['membershipState'];
  observedAt: Date;
}

interface ConversationParticipantRow {
  participant_id: string;
  provider_participant_id: string;
  display_name: string | null;
  phone_e164: string | null;
  is_self: boolean;
  membership_state: ConversationMembershipRecord['membershipState'];
  observed_at: string;
}

export class PostgresConversationMembershipRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async replaceForConversation(input: {
    tenantId: string;
    conversationId: string;
    observedAt: Date;
    memberships: Array<{
      id: string;
      participantId: string;
      membershipState: ConversationMembershipRecord['membershipState'];
      providerMetadata: Record<string, unknown>;
    }>;
  }): Promise<void> {
    await this.db.query(`
      delete from conversation_membership_snapshots
      where tenant_id = ${sqlString(input.tenantId)}
        and conversation_id = ${sqlString(input.conversationId)}
    `);

    for (const membership of input.memberships) {
      await this.db.query(`
        insert into conversation_membership_snapshots (
          id,
          tenant_id,
          conversation_id,
          participant_id,
          membership_state,
          observed_at,
          provider_metadata
        ) values (
          ${sqlString(membership.id)},
          ${sqlString(input.tenantId)},
          ${sqlString(input.conversationId)},
          ${sqlString(membership.participantId)},
          ${sqlString(membership.membershipState)},
          ${sqlTimestamp(input.observedAt)},
          ${sqlJson(membership.providerMetadata)}
        )
      `);
    }
  }

  async listParticipantsByConversation(input: {
    tenantId: string;
    conversationId: string;
  }): Promise<ConversationParticipantSnapshot[]> {
    const rows = await this.db.query<ConversationParticipantRow>(`
      select
        cms.participant_id,
        p.provider_participant_id,
        p.display_name,
        p.phone_e164,
        p.is_self,
        cms.membership_state,
        cms.observed_at
      from conversation_membership_snapshots cms
      inner join participants p on p.id = cms.participant_id
      where cms.tenant_id = ${sqlString(input.tenantId)}
        and cms.conversation_id = ${sqlString(input.conversationId)}
      order by p.is_self desc, p.provider_participant_id asc
    `);

    return rows.map((row) => ({
      participantId: row.participant_id,
      providerParticipantId: row.provider_participant_id,
      displayName: row.display_name,
      phoneE164: row.phone_e164,
      isSelf: row.is_self,
      membershipState: row.membership_state,
      observedAt: new Date(row.observed_at)
    }));
  }
}
