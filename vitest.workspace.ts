import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  {
    test: {
      include: ['tests/**/*.test.ts'],
      name: 'tests',
      environment: 'node',
    },
  },
]);
