import type { PostgresEntityMappingRepository } from '../../storage/src/entity-mapping-repository';
import type { PostgresParticipantRepository } from '../../storage/src/participant-repository';
import { AppError } from '../../query-api/src/errors';

interface CandidateInput {
  entityType: string;
  entityRef: string;
  displayName: string | null;
  phoneE164: string | null;
}

interface ParticipantMatchingServiceDeps {
  participantRepository: PostgresParticipantRepository;
  entityMappingRepository: PostgresEntityMappingRepository;
  now: () => Date;
  createId: (prefix: string) => string;
}

export class ParticipantMatchingService {
  constructor(private readonly deps: ParticipantMatchingServiceDeps) {}

  async createEntityMapping(input: { tenantId: string; participantId: string; entityType: string; entityRef: string; label?: string }) {
    await this.requireParticipant(input.tenantId, input.participantId);
    return this.deps.entityMappingRepository.create({
      id: this.deps.createId('mapping'),
      tenantId: input.tenantId,
      participantId: input.participantId,
      entityType: input.entityType,
      entityRef: input.entityRef,
      label: input.label ?? null,
      mappingStatus: 'active',
      mergedIntoMappingId: null,
      notes: null,
      createdAt: this.deps.now(),
      updatedAt: this.deps.now()
    });
  }

  async listEntityMappings(input: { tenantId: string }) {
    return this.deps.entityMappingRepository.listByTenant(input);
  }

  async mergeParticipantMappings(input: { tenantId: string; sourceMappingId: string; targetMappingId: string }) {
    const source = await this.requireMapping(input.tenantId, input.sourceMappingId);
    const target = await this.requireMapping(input.tenantId, input.targetMappingId);
    await this.deps.entityMappingRepository.update({
      ...source,
      mappingStatus: 'merged',
      mergedIntoMappingId: target.id,
      updatedAt: this.deps.now()
    });
  }

  async listCandidateMatches(input: { tenantId: string; participantId: string; candidateSet: CandidateInput[] }) {
    const participant = await this.requireParticipant(input.tenantId, input.participantId);
    const participantName = normalize(participant.displayName);

    return input.candidateSet.map((candidate) => {
      const reasons: string[] = [];
      if (participant.phoneE164 && candidate.phoneE164 && participant.phoneE164 === candidate.phoneE164) {
        reasons.push('phone_exact');
      }
      if (participantName && participantName === normalize(candidate.displayName)) {
        reasons.push('name_exact');
      }
      return { ...candidate, score: reasons.length, reasons };
    });
  }

  private async requireParticipant(tenantId: string, participantId: string) {
    const participant = await this.deps.participantRepository.getById({ tenantId, id: participantId });
    if (!participant) {
      throw new AppError('not_found', `participant ${participantId} was not found`);
    }
    return participant;
  }

  private async requireMapping(tenantId: string, mappingId: string) {
    const mapping = await this.deps.entityMappingRepository.getById({ tenantId, id: mappingId });
    if (!mapping) {
      throw new AppError('not_found', `mapping ${mappingId} was not found`);
    }
    return mapping;
  }
}

function normalize(value: string | null): string | null {
  return value ? value.trim().toLowerCase() : null;
}
