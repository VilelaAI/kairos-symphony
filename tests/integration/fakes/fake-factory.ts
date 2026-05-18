import type { AgentDescriptor, AgentId, FactoryPort } from '@kairos-symphony/core';

export class FakeFactory implements FactoryPort {
  agents = new Map<AgentId, AgentDescriptor>();

  async loadAgent(id: AgentId): Promise<AgentDescriptor> {
    const a = this.agents.get(id);
    if (!a) throw new Error(`agent ${id} não encontrado`);
    return a;
  }

  async listAgents(): Promise<AgentId[]> {
    return [...this.agents.keys()];
  }
}
