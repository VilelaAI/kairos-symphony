/**
 * Porta do **arco da fábrica** — o contrato de integração do kairos-forge
 * (`kairos-forge/ciclo` v1, ADR-0034 do Forge).
 *
 * Por que existe: até a v0.3 o loop autônomo (§17) parava lendo a última linha de
 * `.perseguir/checkpoint.md` — arquivo escrito **pelo próprio agente**. A condição de
 * parada era a palavra dele. Do outro lado da costura, o Forge passou seis versões
 * removendo exatamente isso: o veredicto vem de artefato, o orçamento é contado por
 * código, a transição é decidida por uma máquina de estados que recusa movimento
 * inválido.
 *
 * O Symphony reimplementou uma versão mais fraca porque, à época, não havia contrato
 * do lado do Forge para depender. Agora há. Esta porta é o consumo dele.
 *
 * Regra de ouro do consumidor: **nunca compare `estado` com string literal.** Use os
 * campos derivados (`terminal`, `aguardandoHumano`, `gate`, `resultadosValidos`) — eles
 * existem no contrato justamente para que renomear um estado do lado de lá não quebre
 * o daemon do lado de cá.
 */

/** Estado do arco, como o contrato `kairos-forge/ciclo` promete. */
export interface ArcState {
  /** Versão do contrato que produziu esta leitura (ex.: `"1.0"`). */
  contrato: string;
  /** SPEC do ciclo. */
  spec: string;
  /** Nome do estado. **Não compare com literal** — use os derivados abaixo. */
  estado: string;
  /** Nada mais a registrar: o arco acabou (encerrado ou escalado). */
  terminal: boolean;
  /** Precisa de resposta de gente, não de agente. */
  aguardandoHumano: boolean;
  /** Gate em jogo (`criticar` | `validar` | `revisar`), null fora de gate. */
  gate: string | null;
  /** Instrução legível do próximo passo, para injetar no prompt do agente. */
  proximoPasso: string;
  /** O que `ciclo.py registrar` aceita NESTE estado. */
  resultadosValidos: string[];
  /** Motivo da escalação, quando houver. */
  motivoEscalacao?: string | undefined;
  /** Motivo do encerramento, quando houver. */
  motivoEncerramento?: string | undefined;
}

export interface ArcPort {
  /**
   * Lê o estado do arco no diretório de trabalho. `null` quando não há ciclo aberto
   * (a issue não é conduzida pelo arco) ou quando a leitura não é confiável — versão
   * de contrato incompatível, script ausente, saída inválida.
   *
   * Nunca lança: falha de leitura degrada para o caminho anterior, e degradar em
   * silêncio é melhor que derrubar um daemon 24/7 por causa de um script faltando.
   */
  read(workspacePath: string): Promise<ArcState | null>;
}

/**
 * Versão MAIOR do contrato que este consumidor entende. Contrato com major diferente
 * é recusado — melhor degradar para o checkpoint do que interpretar campos cuja
 * semântica mudou.
 */
export const ARC_CONTRACT_MAJOR = 1;

/** `true` se a versão do contrato é compatível com este consumidor. */
export function isArcContractSupported(versao: string): boolean {
  const major = Number.parseInt(String(versao).split('.')[0] ?? '', 10);
  return Number.isInteger(major) && major === ARC_CONTRACT_MAJOR;
}
