# Контроль long-running задач: goal-x, Pi 1.4.0, сабагенты, `implement-spec`

Первоисточники к дизайну [`docs/design/implement-spec-control.md`](../design/implement-spec-control.md):
что именно делает goal-x, что разрешает Pi 1.4.0 и какими командами проверяется закрытие спеки.

## 1. Механика goal-x

Подписки — `extensions/goal-events.ts` (пакет `pi-goal-x`):

| Событие | Строка | Что делает | Возврат |
| --- | --- | --- | --- |
| `before_provider_request` | 72 | кэширует историю промпта | payload или `undefined` |
| `context_with_system` | 84 (`goal-context.ts:8`) | фильтрует аудит-сообщения, сжимает старые чекпоинты, инжектирует `state` и счётчики через `LiveTailRetention` | `{ messages }` |
| `tool_call` | 131 | блокирует вызов, если цель остановлена или чекпоинт устарел | `{ block: true, reason }` |
| `turn_end` | 190 | завершение хода, отложенная архивация | `void` |
| `session_before_compact` / `session_compact` | 380, 384 | `core.persist(ctx)`, `armPostCompactReminder()`, `queueContinuation(ctx, true)` | `void` |
| `agent_end` | 564 | учитывает токены прерванных сообщений, взводит `continuationAfterSettleFor = goal.id` | `void` |
| `agent_settled` | 613 | `auditMessages.flush`, `scheduler.settled()` | `void` |

**`agent_before_settle` goal-x не использует вовсе.** Продолжение у него идёт не через
`continue: true`, а через диспетчер:

- `GoalScheduler.schedule()` (`goal-scheduler.ts:354`) → `claim()` (`:381`) с `dispatchId` и `generation`;
- `GoalRuntime.queueContinuation()` (`goal-runtime.ts:74`) ждёт idle (`CONTINUATION_IDLE_RETRY_MS = 50`);
- `sendQueuedContinuation()` (`goal-runtime.ts:143`) → `sendFollowUp` (`goal-state.ts:290`) →
  `pi.sendMessage({ customType, content, display: false }, { triggerTurn: true, deliverAs: "followUp" })`.

Защита от петли: `maxAutonomousRuns` (`goal-scheduler.ts:34`), idle-бэкофф 30→300 с при ходе без
работы (`:41`), `markTurnStopped` (`goal-runtime.ts:182`) — после мутирующего тула ход закрыт,
сверка `dispatchId`/`generation` в `message_start` и `before_agent_start` (`goal-scheduler.ts:246`).

Состояние на диске: `.pi/goals/<goalId>.json`, архив `.pi/goals/archived/<goalId>.json`
(`storage/goal-files.ts:21-22`), журнал `.pi/goals/goal_events.jsonl` (`goal-ledger.ts:8`), снимок
пула `goals-pool-snapshot.json` (`storage/goal-root.ts:65`), блокировки `.pi/goals/.locks/`.

Поля `GoalRecord` (`goal-record.ts:33-66`): `objective`, `status` (`active|paused|blocked|budget_limited|complete`),
`autoContinue`, `usage`, `tokenBudget`, `scheduler` (`owner` = session id, `generation`, `used`, `phase`,
`dispatch`), `taskList` (`tasks[]` с `status`, `evidence`, `verificationContract`), `currentTaskId`.

Инъекция и выживание при сжатии: `currentGoalContextParts()` (`goal-events.ts:503-535`) читает журнал
заново на **каждый** запрос и вставляет `[AUDITOR REJECTION goalId=…]` при отказе; `session_compact`
взводит `armPostCompactReminder()`, следующий ход получает дельту `buildPostCompactionGoalDelta`
(`goal-compaction.ts:85`).

Владение: `/goal-resume` (`goal-commands.ts:350`) → `scheduler.resume` (`goal-scheduler.ts:133`)
переписывает `owner`, обнуляет `used`. `isDelegatedGoalSession` (`goal-session-safety.ts:9-12`) =
`PI_SUBAGENT_CHILD === "1" || PI_SUBAGENT_DEPTH > 0`; в дочернем процессе `goal.ts:19-24` регистрирует
только пассивную фильтрацию контекста — ни команд, ни тулов, ни захвата родительской цели.

## 2. Что даёт Pi 1.4.0

| Хук | Возврат | Ссылка |
| --- | --- | --- |
| `agent_before_settle` | `BoundaryResult`: `{ entries?: SessionBoundaryDraft[]; continue?: boolean }` | `dist/core/extensions/types.d.ts:784,1210` |
| `agent_settled` | `void` (только уведомление) | `types.d.ts:787,1211` |
| `turn_end` | тот же `BoundaryResult` | `types.d.ts:805,1215` |
| `context` | `{ messages?: AgentMessage[] }` — транскрипт без system prompt | `types.d.ts:672,1200` |
| `input` | `{ action: "continue" } \| { action: "transform"; text; images? } \| { action: "handled" }` | `types.d.ts:912,1226` |
| `tool_call` | `{ block?, reason?, terminate? }` | `types.d.ts:983,1223` |
| `sendMessage` | `(msg, { triggerTurn?, deliverAs?: "steer" \| "followUp" \| "nextTurn" })` | `types.d.ts:330,1258` |
| `registerCommand` / `ui.setStatus` / `ui.confirm` / `ui.editor` / `hasUI` | — | `types.d.ts:1229,89,81,140,208` |

Типы записей границы (`dist/core/agent-session.js:512,597,1581`):

- `custom` — `CustomEntry`, **в LLM-контекст не попадает**;
- `custom_message` — конвертируется в `role: "user"` (`dist/core/messages.js:101`), в контекст попадает;
- `context_edit` — замена/вырезание сообщения;
- `compaction` — принудительный рубеж сжатия.

**Ловушка `continue: true`:** `_buildBoundaryContext()` (`agent-session.js:597`) вычисляет
`canContinue = false`, если последнее спроецированное сообщение имеет роль `assistant`.
Возврат `{ continue: true }` без `custom_message` (или без сообщений в очереди) даёт ошибку
`"<boundary> requested continuation without runnable model context"`, и продолжение **отклоняется**.
Значит `continue: true` всегда идёт в паре с `entries: [{ type: "custom_message", … }]`.

Обычный `custom_message` схлопывается при сжатии, если оказался за `firstKeptEntryId`. Полная
гарантия — пересборка блока каждым запросом (`context`) либо реакция на `session_compact`.

## 3. Сабагенты

`pi-subagents` (`bundle/chunk-DZDETGRJ.js:7520`) создаёт дочернюю сессию через
`pi.createAgentSession({ cwd, resourceLoader, sessionManager, … })` со своим `DefaultResourceLoader`,
поэтому **фабрики расширений выполняются заново** (если `launch.ambientExtensions !== false`).

Доступа к JS-объектам родителя нет: только файлы на диске, канал `contact_supervisor`
(`bundle/chunk-7BWGNDNK.js:240`) и финальный результат. В `process.env` дочернего процесса:
`PI_SUBAGENT_CHILD="1"`, `PI_SUBAGENT_DEPTH`, `supervisorChannelDir`.

Следствие: наследственность фазы возможна только через файл состояния родителя.

## 4. Тикеты и трекер

`docs/agents/issue-tracker.md`:

- открытые тикеты: `gh issue list --state open --json number,title,body,labels --jq '…'`;
- готовность к взятию: `gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by` = `0`;
- привязка к спеке: `gh issue edit <parent> --add-sub-issue <child>` (gh 2.94+), иначе строка
  `Part of #<parent>` в теле;
- claim: `gh issue edit <n> --add-assignee @me`; закрытие: `gh issue comment`, `gh issue close <n>`.

Метки (`docs/agents/triage-labels.md`): `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`.

## 5. Якоря `implement-spec`

`C:/Users/ralex/.agents/skills/implement-spec/SKILL.md`:

| Шаг | Дословно | Строка |
| --- | --- | --- |
| 1 | `Read the spec and tickets to understand the task graph.` | 24 |
| 2 | `(optional) Use an **exploration subagent** … save its markdown notes in a directory outside the repo` | 26 |
| 3 | `Create the integration branch.` | 28 |
| 4 | `Use a fresh **implementer subagent** for each ticket, each in its own worktree on its own branch.` | 30 |
| 5 | `Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**.` | 35 |
| 6 | `If this changes the **frontier** of available tickets, kick off more **implementer subagents**` | 37 |
| 7 | `Once all tickets are complete, call the Skill tool with \`code-review\` on the integration branch.` | 39 |
| 8 | `If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work` | 41 |
| 9 | `Clean up all **implementer subagent** worktrees.` | 43 |

## 6. Вывод для дизайна

- Объект (спека) и леджер тикетов должны лежать **на диске** и пересобираться в контекст из
  состояния, а не из истории: `context` (или `context_with_system`) — единственный способ пережить
  сжатие гарантированно.
- Продолжение возможно двумя путями: `agent_before_settle` + `entries: [custom_message]` +
  `continue: true` (граничный, с валидацией) или `pi.sendMessage(…, { triggerTurn: true,
  deliverAs: "followUp" })` (путь goal-x, без валидации «последнее сообщение — assistant»).
- Механический гейт закрытия спеки — запрос к трекеру, а не вопрос человеку.
- Сабагенты читают состояние родителя только через файл; иначе они неохраняемы.

## 7. Не проверено

- гонки при одновременном завершении двух фоновых сабагентов (`followUp` против `steer`);
- точный endpoint списка sub-issues в установленной версии `gh` (в репозитории описан `--parent`/`--add-sub-issue`, обратное чтение — нет);
- совместная работа `ui.setStatus` skill-guard с виджетами других расширений.
