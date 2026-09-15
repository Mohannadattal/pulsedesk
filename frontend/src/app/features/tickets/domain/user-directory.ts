import { UserDirectoryEntry } from '../../../api/generated/model/userDirectoryEntry';

export interface AgentDirectoryEntry {
  readonly id: number;
  readonly name: string;
}

export function mapAgentDirectoryEntry(dto: UserDirectoryEntry): AgentDirectoryEntry {
  return {
    id: dto.id,
    name: `${dto.first_name} ${dto.last_name}`.trim(),
  };
}
