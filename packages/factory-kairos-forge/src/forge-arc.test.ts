import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ForgeArc } from './forge-arc.js';

/**
 * Estes testes rodam contra o `ciclo.py` REAL do kairos-forge quando ele está
 * disponível — é o único jeito de verificar que a leitura do contrato funciona de
 * ponta a ponta. Sem o Forge instalado, um fake do script preserva o contrato e o
 * teste continua valendo: o que se verifica aqui é o **consumo do contrato**, não o
 * comportamento da máquina de estados (esse é testado do lado do Forge).
 */

function temPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Escreve um `ciclo.py` mínimo que responde o contrato v1 com o estado pedido.
 * O payload vai num arquivo ao lado — embutir JSON como literal Python quebra em
 * `false`/`null`, que é justamente o que este contrato mais usa.
 */
function scriptFake(estado: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-scripts-'));
  writeFileSync(join(dir, 'estado.json'), JSON.stringify(estado));
  writeFileSync(
    join(dir, 'ciclo.py'),
    [
      'import sys, pathlib',
      'if sys.argv[1:3] != ["estado", "--json"]: sys.exit(2)',
      'print((pathlib.Path(__file__).parent / "estado.json").read_text(encoding="utf-8"))',
      '',
    ].join('\n'),
  );
  return dir;
}

const ws = () => mkdtempSync(join(tmpdir(), 'forge-ws-'));

describe.skipIf(!temPython())('ForgeArc — consumo do contrato kairos-forge/ciclo', () => {
  it('lê o estado e mapeia os campos derivados', async () => {
    const arc = new ForgeArc({
      scriptsDir: scriptFake({
        contrato: '1.0',
        spec: 'SPEC-001',
        estado: 'aguardando_aprovacao',
        terminal: false,
        aguardando_humano: true,
        gate: null,
        proximo_passo: 'GATE HUMANO — espere SIM/NÃO/AJUSTAR.',
        resultados_validos: ['aprovada', 'recusada'],
      }),
    });
    const s = await arc.read(ws());
    expect(s).not.toBeNull();
    expect(s?.spec).toBe('SPEC-001');
    expect(s?.aguardandoHumano).toBe(true);
    expect(s?.terminal).toBe(false);
    expect(s?.resultadosValidos).toEqual(['aprovada', 'recusada']);
    expect(s?.proximoPasso).toContain('GATE HUMANO');
  });

  it('propaga motivo de escalação', async () => {
    const arc = new ForgeArc({
      scriptsDir: scriptFake({
        contrato: '1.0',
        spec: 'SPEC-9',
        estado: 'escalado',
        terminal: true,
        aguardando_humano: false,
        gate: null,
        proximo_passo: 'PARADO.',
        resultados_validos: [],
        motivo_escalacao: 'teto absoluto de validar atingido (6/6 rodadas)',
      }),
    });
    const s = await arc.read(ws());
    expect(s?.terminal).toBe(true);
    expect(s?.motivoEscalacao).toContain('teto absoluto');
  });

  it('recusa contrato de major diferente — degrada em vez de interpretar errado', async () => {
    const avisos: string[] = [];
    const arc = new ForgeArc({
      scriptsDir: scriptFake({
        contrato: '2.0',
        spec: 'SPEC-1',
        estado: 'validando',
        terminal: false,
        aguardando_humano: false,
        gate: 'validar',
        proximo_passo: 'x',
        resultados_validos: [],
      }),
      onWarn: (m) => avisos.push(m),
    });
    expect(await arc.read(ws())).toBeNull();
    expect(avisos.join(' ')).toContain('incompatível');
  });

  it('saída sem `contrato` é recusada', async () => {
    const arc = new ForgeArc({
      scriptsDir: scriptFake({ spec: 'SPEC-1', estado: 'validando', terminal: false }),
    });
    expect(await arc.read(ws())).toBeNull();
  });

  it('exit != 0 (nenhum ciclo aberto) é ausência, não erro', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-scripts-'));
    writeFileSync(join(dir, 'ciclo.py'), 'import sys\nsys.exit(1)\n');
    const arc = new ForgeArc({ scriptsDir: dir });
    await expect(arc.read(ws())).resolves.toBeNull();
  });

  it('sem ciclo.py, o arco se declara indisponível e lê null', async () => {
    const arc = new ForgeArc({ scriptsDir: mkdtempSync(join(tmpdir(), 'vazio-')) });
    expect(arc.disponivel()).toBe(false);
    await expect(arc.read(ws())).resolves.toBeNull();
  });

  it('saída que não é JSON é recusada com aviso', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-scripts-'));
    writeFileSync(join(dir, 'ciclo.py'), "print('nao sou json')\n");
    const avisos: string[] = [];
    const arc = new ForgeArc({ scriptsDir: dir, onWarn: (m) => avisos.push(m) });
    expect(await arc.read(ws())).toBeNull();
    expect(avisos.join(' ')).toContain('não é JSON');
  });
});

/**
 * Ponta a ponta contra o `ciclo.py` de verdade, quando o Forge está no disco. É o
 * teste que pega divergência real de contrato entre os dois repositórios.
 */
const forgeScripts = process.env.KAIROS_FORGE_SCRIPTS ?? '';
const temForge = forgeScripts !== '' && existsSync(join(forgeScripts, 'ciclo.py'));

describe.skipIf(!temForge || !temPython())('ForgeArc — contra o ciclo.py real do Forge', () => {
  it('abre um ciclo e lê o estado inicial pelo contrato', async () => {
    const projeto = ws();
    mkdirSync(join(projeto, 'docs', 'specs'), { recursive: true });
    execFileSync('python3', [join(forgeScripts, 'ciclo.py'), 'abrir', 'SPEC-001'], {
      cwd: projeto,
      stdio: 'ignore',
    });
    const arc = new ForgeArc({ scriptsDir: forgeScripts });
    const s = await arc.read(projeto);
    expect(s).not.toBeNull();
    expect(s?.spec).toBe('SPEC-001');
    expect(s?.terminal).toBe(false);
    expect(s?.resultadosValidos.length).toBeGreaterThan(0);
    expect(s?.proximoPasso.length).toBeGreaterThan(0);
    // O consumidor não compara nome de estado — mas o contrato precisa dizer o que
    // aceita agora, e `registrar` de algo fora disso tem de falhar.
    expect(() =>
      execFileSync('python3', [join(forgeScripts, 'ciclo.py'), 'registrar', 'inventado'], {
        cwd: projeto,
        stdio: 'ignore',
      }),
    ).toThrow();
  });

  it('gate humano do Forge aparece como aguardandoHumano', async () => {
    const projeto = ws();
    mkdirSync(join(projeto, 'docs', 'specs'), { recursive: true });
    const ciclo = (...args: string[]) =>
      execFileSync('python3', [join(forgeScripts, 'ciclo.py'), ...args], {
        cwd: projeto,
        stdio: 'ignore',
      });
    ciclo('abrir', 'SPEC-002');
    ciclo('registrar', 'entendimento_pronto');
    const s = await new ForgeArc({ scriptsDir: forgeScripts }).read(projeto);
    expect(s?.aguardandoHumano).toBe(true);
    expect(s?.terminal).toBe(false);
  });
});
