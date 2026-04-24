import { describe, expect, it } from 'vitest';
import { ParticipantMatchingService } from '../../packages/participant-matching-service/src/participant-matching-service';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresEntityMappingRepository } from '../../packages/storage/src/entity-mapping-repository';
import { PostgresParticipantRepository } from '../../packages/storage/src/participant-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('participant matching service', () => {
  it('creates, lists, and merges participant mappings', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedParticipants(harness);

      const service = new ParticipantMatchingService({
        participantRepository: new PostgresParticipantRepository(harness),
        entityMappingRepository: new PostgresEntityMappingRepository(harness),
        now: () => new Date('2026-01-12T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const source = await service.createEntityMapping({
        tenantId: 'tenant_1',
        participantId: 'participant_1_id',
        entityType: 'contact',
        entityRef: 'contact-1',
        label: 'Alice source'
      });
      const target = await service.createEntityMapping({
        tenantId: 'tenant_1',
        participantId: 'participant_1_id',
        entityType: 'contact',
        entityRef: 'contact-2',
        label: 'Alice target'
      });

      await service.mergeParticipantMappings({
        tenantId: 'tenant_1',
        sourceMappingId: source.id,
        targetMappingId: target.id
      });

      await expect(
        service.listEntityMappings({ tenantId: 'tenant_1' })
      ).resolves.toMatchObject([
        {
          id: source.id,
          mappingStatus: 'merged',
          mergedIntoMappingId: target.id
        },
        {
          id: target.id,
          mappingStatus: 'active',
          mergedIntoMappingId: null
        }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('returns deterministic candidate matches based on exact phone and normalized name overlap', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedParticipants(harness);

      const service = new ParticipantMatchingService({
        participantRepository: new PostgresParticipantRepository(harness),
        entityMappingRepository: new PostgresEntityMappingRepository(harness),
        now: () => new Date('2026-01-12T00:00:00.000Z'),
        createId: (prefix: string) => `${prefix}_1`
      });

      await expect(
        service.listCandidateMatches({
          tenantId: 'tenant_1',
          participantId: 'participant_1_id',
          candidateSet: [
            { entityType: 'contact', entityRef: 'crm_1', displayName: 'Alice', phoneE164: '+15550000001' },
            { entityType: 'contact', entityRef: 'crm_2', displayName: 'Alicia', phoneE164: '+15550000009' },
            { entityType: 'contact', entityRef: 'crm_3', displayName: 'Bob', phoneE164: '+15550000002' }
          ]
        })
      ).resolves.toMatchObject([
        { entityRef: 'crm_1', score: 2, reasons: ['phone_exact', 'name_exact'] },
        { entityRef: 'crm_2', score: 0, reasons: [] },
        { entityRef: 'crm_3', score: 0, reasons: [] }
      ]);
    } finally {
      await harness.close();
    }
  });
});

async function seedParticipants(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  const connectionRepository = new PostgresConnectionRepository(harness);
  const participantRepository = new PostgresParticipantRepository(harness);

  await connectionRepository.create({
    id: 'conn_1',
    tenantId: 'tenant_1',
    workspaceUserRef: 'user_1',
    provider: 'whatsapp_linked',
    status: 'connected',
    statusReason: 'none',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    providerAccountRef: null,
    deviceLabel: null,
    lastConnectedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastHeartbeatAt: null,
    reauthRequiredAt: null,
    disconnectedAt: null
  });

  await participantRepository.upsert({
    id: 'participant_1_id',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    providerParticipantId: 'provider_participant_1',
    phoneE164: '+15550000001',
    displayName: 'Alice',
    profileName: null,
    waBusinessName: null,
    isSelf: false,
    providerMetadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  });
}
