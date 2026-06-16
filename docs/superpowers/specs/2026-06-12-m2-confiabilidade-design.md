# M2 — Confiabilidade: design

**Data:** 2026-06-12
**Status:** Implementado
**Cobre:** segundo milestone da implementação do `kairos-symphony`, fechando os pontos de confiabilidade deixados em aberto pelo M1 (ver [design do M1](2026-05-14-m1-walking-skeleton-design.md), §1).

---

## 1. Escopo

O M1 entregou o happy path end-to-end com uma camada de confiabilidade mínima
(stall por silêncio do PTY, retry com backoff, reconciliação dos 6 cenários com
o 6º em modo log-only). O M2 fecha os três itens que o próprio design do M1
listou como "fora — vai para M2":

1. **Heartbeat cooperativo (§8.1)**
2. **Hardening do spawn de PTY (§4.1)**
3. **Reconstrução de estado interno perdido (§9.1, 6º cenário)**

Fora do M2: `/healthz` e `/metrics` (M3), audit log estruturado adicional (M3),
sandbox forte (M3), harness-readiness (M4), loop autônomo (M5).

---

## 2. Heartbeat cooperativo (§8.1)

**Problema.** No M1, a única evidência de "vivo" era output no PTY
(`lastOutputAt`). Um agente em tarefa longa e silenciosa (compilação, suíte de
testes, "pensando") pode ficar minutos sem emitir nada e ser morto por engano.

**Solução.** Sinal cooperativo adicional: o agente atualiza
`<workspace>/.symphony/heartbeat` periodicamente (instruído pelo `PromptBuilder`,
intervalo `limits.heartbeat_interval_ms`). O supervisor calcula
`liveness = max(lastOutputAt, mtime(heartbeat))` e só declara stall quando
**ambos** os sinais excedem `stall_timeout_ms`. Proxy (PTY) e cooperativo
(heartbeat) se complementam: o proxy cobre agentes que não cooperam; o
heartbeat cobre agentes que cooperam mas ficam silenciosos.

- Leitura do heartbeat é injetável (`readHeartbeat`) para testes determinísticos
  com clock falso; em produção, default = `mtime` do arquivo (ou `null` se
  ausente → fallback ao comportamento M1).

## 3. Hardening do spawn de PTY (§4.1)

| Item | M1 | M2 |
|---|---|---|
| Encerrar processo | só `SIGTERM` | **SIGTERM → grace (`kill_grace_ms`) → SIGKILL**, com guarda para não matar um processo de retry recém-spawnado |
| Falha de `spawn()` | propagava (risco de derrubar o tick) | tratada como **crash da issue** → `scheduleRetry()` |
| `kill` após exit | podia lançar `ESRCH` | **idempotente** no adapter Claude Code |
| Diagnóstico em falha | só `event` | ring buffer das **últimas 50 linhas** (`last_output`) em `agent_crashed`/`agent_stalled` (§8.2) |

## 4. Reconstrução de estado interno perdido (§9.1)

**Problema.** O 6º cenário da §9.1 ("daemon reiniciou e o SQLite corrompeu ou
foi apagado") era, no M1, apenas logado (`orphan_workspace_detected`).

**Solução.** Quando há worktree em disco sem registro no DB, o reconciliador
busca issues ativas no tracker (`in_progress` + `review_pending`), casa pelo
nome de diretório (`describeWorkspace(issueId).dirName`) e **reconstrói** o
`IssueRecord` (workspace + branch). Como o processo morreu e a §9 proíbe
restart automático, a issue reconstruída vai para
`blocked: symphony:needs-reconciliation` com o workspace preservado — o operador
retoma explicitamente. Sem match no tracker, mantém-se o log-only conservador
(nunca destruir trabalho em ambiguidade, §9.1 princípio 3).

- `--dry-run` reporta o finding `internal_state_lost` sem mutar store nem tracker.
- Novos eventos no vocabulário: `state_reconstructed`, `agent_sigkilled`.

---

## 5. Testes

- **Unit:** heartbeat mantém vivo / congela → stall; spawn-error → retry;
  escalada SIGTERM→SIGKILL; captura de `last_output`; reconstrução (real + dry-run).
- **Conformance:** `spec-08` (heartbeat §8.1) e `spec-09-1` (reconstrução §9.1).
- **Integration:** `reconstruct.integration.test.ts` — worktree real + DB vazio +
  issue ativa no tracker → reconstrói em blocked, preserva o workspace.

Suíte total após M2: **114 testes** em 32 arquivos, lint e typecheck verdes.

---

## 6. Próximo

M3 — Segurança & observabilidade ampla: `/healthz`, `/metrics` Prometheus,
audit log estruturado, sandbox forte.
