import type { Issue } from '../domain/issue.js';

export type IterationMode = 'single' | 'loop';

export interface PerLabelOverride {
  label: string;
  mode: IterationMode;
  maxIterations?: number;
}

/** Configuração global de iteração (§17.2, item 2). */
export interface IterationConfig {
  defaultMode: IterationMode;
  defaultMaxIterations: number;
  defaultCompletionPromise: string;
  perLabelOverrides: PerLabelOverride[];
  loopWarningThresholdMs: number;
}

export interface ResolvedIteration {
  mode: IterationMode;
  maxIterations: number;
  completionPromise: string;
  validationCommand?: string;
}

export const DEFAULT_ITERATION_CONFIG: IterationConfig = {
  defaultMode: 'single',
  defaultMaxIterations: 10,
  defaultCompletionPromise: 'DONE',
  perLabelOverrides: [],
  loopWarningThresholdMs: 4 * 60 * 60 * 1000,
};

interface FrontmatterIterate {
  mode?: IterationMode;
  maxIterations?: number;
  completionPromise?: string;
  validationCommand?: string;
}

/**
 * Extrai o bloco `iterate:` do frontmatter YAML da descrição da issue (§17.2,
 * item 3). Parser mínimo e sem dependências: lê o bloco `---...---` no início do
 * corpo e as chaves indentadas sob `iterate:`. Retorna null se não houver
 * frontmatter ou bloco `iterate:`.
 */
export function parseIterateFrontmatter(body: string): FrontmatterIterate | null {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(body);
  if (!match) return null;
  const lines = (match[1] ?? '').split(/\r?\n/);
  const idx = lines.findIndex((l) => /^iterate\s*:\s*$/.test(l));
  if (idx === -1) return null;

  const out: FrontmatterIterate = {};
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!/^\s+\S/.test(line)) break; // saiu do bloco indentado de iterate:
    const kv = /^\s+([a-z_]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = unquote(kv[2] ?? '');
    if (key === 'mode' && (value === 'single' || value === 'loop')) out.mode = value;
    else if (key === 'max_iterations') {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) out.maxIterations = n;
    } else if (key === 'completion_promise') out.completionPromise = value;
    else if (key === 'validation_command') out.validationCommand = value;
  }
  return out;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Resolve o modo de iteração de uma issue (§17.2). Precedência:
 * frontmatter > label `iterate:*` > per-label override > default global.
 */
export function resolveIterationMode(issue: Issue, config: IterationConfig): ResolvedIteration {
  const resolved: ResolvedIteration = {
    mode: config.defaultMode,
    maxIterations: config.defaultMaxIterations,
    completionPromise: config.defaultCompletionPromise,
  };

  for (const ov of config.perLabelOverrides) {
    if (issue.labels.includes(ov.label)) {
      resolved.mode = ov.mode;
      if (ov.maxIterations !== undefined) resolved.maxIterations = ov.maxIterations;
    }
  }

  for (const label of issue.labels) {
    if (label === 'iterate:single') resolved.mode = 'single';
    else if (label === 'iterate:loop') resolved.mode = 'loop';
    else {
      const m = /^iterate:loop:(\d+)$/.exec(label);
      if (m) {
        resolved.mode = 'loop';
        resolved.maxIterations = Number(m[1]);
      }
    }
  }

  const fm = parseIterateFrontmatter(issue.body);
  if (fm) {
    if (fm.mode) resolved.mode = fm.mode;
    if (fm.maxIterations) resolved.maxIterations = fm.maxIterations;
    if (fm.completionPromise) resolved.completionPromise = fm.completionPromise;
    if (fm.validationCommand) resolved.validationCommand = fm.validationCommand;
  }

  return resolved;
}
