# M5 — Loop autônomo por issue: design

**Data:** 2026-06-15
**Status:** Implementado — fecha a conformidade v0.3 da SPEC
**Cobre:** quinto e último milestone, §17 completa. Ver [design do M1](2026-05-14-m1-walking-skeleton-design.md), §1.

---

## 1. Escopo

§17 é uma capability **MAY**: executar uma issue em **modo loop** — iterar contra
um critério verificável até atingi-lo ou esgotar `max_iterations`, em vez de
single-shot. Muda o modelo de execução; foi implementada de forma **aditiva** (o
caminho single-shot permanece intacto quando não há config de loop).

| Item | SPEC | Entrega |
|---|---|---|
| Resolução de modo | §17.2 | `resolveIterationMode` (label/config/frontmatter) |
| Execução do loop | §17.3 | modo loop no `AgentSupervisor` + checkpoint |
| Adaptação por CLI | §17.4 | fallback universal (re-spawn manual) |
| Concorrência | §17.5 | 1 slot por loop + aviso de long-running |

## 2. Resolução de modo (§17.2)

`packages/core/src/services/iteration.ts`. Precedência (menor → maior):

1. **default global** (`iteration.default_*`)
2. **per-label override** (`iteration.per_label_overrides`)
3. **label `iterate:*`** — `iterate:single`, `iterate:loop`, `iterate:loop:N`
4. **frontmatter** da descrição (precedência máxima) — bloco YAML `iterate:` com
   `mode`, `max_iterations`, `completion_promise`, `validation_command`

`parseIterateFrontmatter` é um parser mínimo sem dependências (não puxa `yaml`
para o core): lê o bloco `---...---` inicial e as chaves indentadas sob `iterate:`.

## 3. Execução do loop (§17.3)

Implementada **dentro do `AgentSupervisor`**, gated por `deps.loop` — reusa todo o
plumbing existente (spawn PTY, terminal log, heartbeat, detecção de stall, kill
com escalada, métricas). Diferenças do single-shot:

- **Checkpoint** `<workspace>/.perseguir/checkpoint.md` criado antes da 1ª iteração.
- **Prompt por iteração** = prompt §6 + checkpoint atual + comando de validação +
  condição de parada + número da iteração.
- **Fim de iteração** (`onProcessExit` em modo loop, qualquer exit code) lê a
  última linha não-vazia do checkpoint:
  - `== completion_promise` (ex. `DONE`) → `completeLoop()` → `review_pending`
  - `BLOCKED: <motivo>` → `blocked` (`symphony:loop-blocked: <motivo>`)
  - senão → se `iteration >= max` → `blocked: symphony:max-iterations-exceeded`;
    caso contrário re-`start()` (próxima iteração).
- **Stall** em loop mata o processo e deixa o `onProcessExit` avaliar o checkpoint
  (não entra no retry/backoff do single-shot).
- **`terminate()`** marca `stopping` → o loop não inicia nova iteração.

## 4. Adaptação por CLI (§17.4)

Implementado o **fallback universal** (re-spawn manual com checkpoint no prompt),
que a própria SPEC declara "mais simples mas equivalente" e funciona para Claude
Code, Codex e OpenCode. Integração com mecanismos nativos (plugin ralph-loop,
`/goal`) é evolução do suporte multi-CLI (v0.4).

## 5. Concorrência (§17.5)

O loop ocupa **1 slot** durante toda a execução: o `Daemon` mantém **um**
`AgentSupervisor` no mapa por issue, e as iterações re-spawnam dentro dele —
`onDone` (que libera o slot) só é chamado no estado terminal. Aviso
`loop_long_running` emitido uma vez quando o loop excede `loop_warning_threshold_ms`.

## 6. Testes

- **Unit:** `resolveIterationMode`/`parseIterateFrontmatter` (precedência,
  frontmatter); `AgentSupervisor` loop (DONE → review_pending, re-spawn,
  `BLOCKED`, max-iterations, `terminate` encerra o loop).
- **Conformance:** `spec-17-loop` via Daemon (label → loop, DONE → review_pending
  em 1 slot, max-iterations → blocked, default single-shot).

Suíte total após M5: **161 testes** em 40 arquivos, lint e typecheck verdes.

---

## 7. Estado final

Com o M5, os 5 milestones fecham a **conformidade v0.3 da SPEC**. Próximas
evoluções (v0.4+) estão fora desta trilha: multi-CLI (Codex, OpenCode), multi-
tracker (GitLab, Jira, Linear), webhook receiver e mecanismos de loop nativos.
