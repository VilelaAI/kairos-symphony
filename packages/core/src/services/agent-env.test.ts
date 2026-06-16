import { describe, expect, it } from 'vitest';
import { sanitizeAgentEnv } from './agent-env.js';

describe('sanitizeAgentEnv (§12)', () => {
  it('remove variáveis que parecem segredos, preserva as benignas', () => {
    const out = sanitizeAgentEnv({
      PATH: '/usr/bin',
      HOME: '/home/user',
      GITHUB_TOKEN: 'ghp_xxx',
      AWS_SECRET_ACCESS_KEY: 'abc',
      MY_API_KEY: 'k',
      DB_PASSWORD: 'p',
      SOME_AUTHORIZATION: 'bearer',
      LANG: 'pt_BR.UTF-8',
    });
    expect(out.PATH).toBe('/usr/bin');
    expect(out.HOME).toBe('/home/user');
    expect(out.LANG).toBe('pt_BR.UTF-8');
    expect(out.GITHUB_TOKEN).toBeUndefined();
    expect(out.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(out.MY_API_KEY).toBeUndefined();
    expect(out.DB_PASSWORD).toBeUndefined();
    expect(out.SOME_AUTHORIZATION).toBeUndefined();
  });

  it('remove chaves explícitas do denyKeys (ex.: nome da env do token do tracker)', () => {
    const out = sanitizeAgentEnv(
      { PATH: '/usr/bin', MY_TRACKER_PAT: 'secret-value' },
      { denyKeys: ['MY_TRACKER_PAT'] },
    );
    expect(out.PATH).toBe('/usr/bin');
    expect(out.MY_TRACKER_PAT).toBeUndefined();
  });

  it('allowKeys preserva credenciais do CLI mesmo casando com padrão de segredo', () => {
    const out = sanitizeAgentEnv(
      { ANTHROPIC_API_KEY: 'sk-ant', OTHER_API_KEY: 'drop-me' },
      { allowKeys: ['ANTHROPIC_API_KEY'] },
    );
    expect(out.ANTHROPIC_API_KEY).toBe('sk-ant');
    expect(out.OTHER_API_KEY).toBeUndefined();
  });

  it('denyKeys tem precedência sobre allowKeys', () => {
    const out = sanitizeAgentEnv({ X: 'v' }, { denyKeys: ['X'], allowKeys: ['X'] });
    expect(out.X).toBeUndefined();
  });

  it('descarta valores undefined', () => {
    const out = sanitizeAgentEnv({ A: 'x', B: undefined });
    expect(out).toEqual({ A: 'x' });
  });
});
