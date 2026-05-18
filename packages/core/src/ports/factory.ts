import type { AgentDescriptor, AgentId } from '../domain/agent.js';

export interface FactoryPort {
  loadAgent(id: AgentId): Promise<AgentDescriptor>;
  listAgents(): Promise<AgentId[]>;
}
