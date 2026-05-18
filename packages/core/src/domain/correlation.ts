import { v4 as uuidv4 } from 'uuid';

export function newCorrelationId(): string {
  return uuidv4();
}
