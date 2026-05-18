export type AgentId = string;

export interface AgentDescriptor {
  id: AgentId;
  name: string;
  description: string;
  body: string;
  filePath: string;
}
