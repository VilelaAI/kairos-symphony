#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { attachCommand } from './commands/attach.js';
import { psCommand } from './commands/ps.js';
import { reconcileCommand } from './commands/reconcile.js';
import { startCommand } from './commands/start.js';

const main = defineCommand({
  meta: { name: 'symphony', version: '0.1.0', description: 'kairos-symphony daemon' },
  subCommands: {
    start: startCommand,
    reconcile: reconcileCommand,
    ps: psCommand,
    attach: attachCommand,
  },
});

void runMain(main);
