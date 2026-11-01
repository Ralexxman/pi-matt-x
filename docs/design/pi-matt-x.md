# pi-matt-x — расширение Pi для флоу mattpocock

Решение по итогам гриля. Термины — по [GLOSSARY.md](../../GLOSSARY.md), ключевые развилки — в [docs/adr/](../adr/).

## Задача

Флоу живёт в `SKILL.md` и умирает вместе с контекстом: после сжатия модель перестаёт помнить, что раунд гриля был последним, что тикеты утверждены, что `code-review` уже запускался. Расширение должно помнить фазу и порядок фаз за моделью и механически запрещать шаги, до которых ещё не дошло.

Расширение хранит **состояние процесса и правила перехода**. Инструкции остаются в скиллах — они и так в контексте, но после сжатия исчезают; повторное чтение `SKILL.md` не должно становиться обязательным ритуалом.

## Чего расширение не делает

- Не переписывает и не подменяет скиллы.
- Не оценивает качество работы модели и не читает её рассуждения.
- Не требует правок в `mattpocock-skills` — набор остаётся как есть.
- Не работает без скилла: сессия без фазы живёт как обычная сессия Pi.

## Проверенные факты о Pi (1.4.0)

| Факт | Где проверено |
| --- | --- |
| Хук `input` выполняется **до** `_expandSkillCommand` — видно сырой текст `/skill:<name> args` | `dist/core/agent-session.js:1739` |
| Блок скилла после раскрытия: `<skill name="…" location="…">\nReferences are relative to <baseDir>.\n\n<body>\n</skill>` + args, вставляется как user-сообщение | `agent-session.js` `_expandSkillCommand` |
| `input` возвращает `{action:"handled"}` (съесть ввод) или `{action:"transform", text, images?}` (заменить) | `docs/extensions.md` |
| У встроенных инструментов **нет** аннотаций; `readOnlyHint` есть только у MCP-инструментов | `grep -rln annotations dist/core/tools/` → пусто |
| `yaml` лежит в `node_modules` Pi, но это транзитивная зависимость — из пакета не резолвится | `require.resolve("yaml")` от корня пакета |
| Пакет Pi: конвенциональные каталоги `extensions/`, `skills/`, `prompts/`, `themes/` + `package.json`; хост-пакеты в `peerDependencies` с `"*"`, не в `dependencies` | `docs/packages.md` |
| Установка из git по тегу: `pi install git:github.com/Ralexxman/pi-matt-x@v1` — клонируется и сверяется с ref | `docs/packages.md` |
| Дочерняя сессия помечена `PI_SUBAGENT_CHILD=1`, знает родителя через `PI_SUBAGENT_PARENT_SESSION` | `pi-subagents/src/extension/doctor.js:153`, `src/runs/shared/child-runtime-config.js:14` |
| Node v24.22.2 — тесты гоняются `node --test`, без сборки и без `tsx` | `node -v` |

## Вход и граф фаз

Фаза начинается, когда загружается скилл. Два входа:

1. `/skill:<name>` — всегда (пользователь командует, расширение только фиксирует и проверяет допустимость; при недопустимом порядке спрашивает `ctx.ui.confirm`, без UI — выполняет и пишет в журнал `superseded/no-ui`).
2. `read` файла `SKILL.md` — только если этот скилл объявлен наследником текущей фазы («можешь пойти читать»).

Любой другой скилл в фазе, где он не наследник, — не открывается.

Граф из цитат в скиллах, все 10 контрактов входят в v1:

```text
grilling ─→ grill-me ─→ grill-with-docs ─→ spec ─→ tickets ─→ implement ─→ code-review
                                               └─→ request-refactor-plan ─→ implement
implement ─→ tdd → diagnosing-bugs → code-review   (внутренние шаги, тот же граф)
```

## Контракт

```ts
type Capability = "files" | "commands" | "network";

type Gate =
  | { kind: "user"; quote: string }                                   // закрывается новым сообщением пользователя
  | { kind: "artifact"; path: string; headings?: string[]; quote: string } // файл + дословные заголовки
  | { kind: "command"; glob: string; expect: "zero" | "nonzero"; quote: string }
  | { kind: "visited"; skills: string[]; quote: string };            // эти фазы реально открывались

type Contract = {
  skill: string;
  grants: Capability[];   // что фаза НЕ запрещает; отсутствие = запрещено
  gates: Gate[];
  next: string[];         // объявленные наследники
};
```

`quote` — дословная фраза из `SKILL.md`, на которой основан гейт. `npm test` проверяет, что она на месте; расхождение печатается как «дрейф». Номера строк не хранятся (см. [ADR-0003](../adr/0003-contracts-cite-the-skill.md)).

## Движок

Чистое ядро + тонкие адаптеры к Pi. Ядро ничего не знает о Pi и тестируется без него.

```text
src/contracts/      по файлу на скилл, данные
src/engine.ts       decide(capability, toolName, state, contracts) → allow | block(reason)
                    enter(state, skill) → state | refuse
                    closeGate(state, gateId, evidence) → state
src/state.ts        чтение/запись .pi/skills-guard/sessions/<id>.json (temp + rename)
src/paths.ts        поиск корня проекта вверх от cwd по .pi или .git
src/render.ts       блок фазы для context
src/journal.ts      .pi/skills-guard/events.jsonl, append-only
extensions/skill-guard.ts   единственная точка подключения к Pi
```

Точки подключения к Pi:

- `input` — распознать `/skill:<name>`, решить `enter`, при отказе вернуть отказ, а не съесть ввод.
- `context` — вставить блок фазы: стабильная часть (имя фазы, что разрешено) + волатильный хвост (открытые гейты), чтобы не ломать префикс-кеш на каждом шаге.
- `tool_call` — отобразить имя инструмента в возможность и заблокировать, если контракт её не даёт или открыт гейт. Блок возвращается как `{block: true, reason}` с указанием, какой гейт закрыть.
- `agent_settled` — не используется (см. «Не в v1»).

Отображение инструментов в возможности — регексп по имени с настройкой в `settings.json`:

- `files` — `edit|write|patch|apply_patch|ctx_edit|ctx_write|multi_edit|str_replace`
- `commands` — `bash|shell|ctx_shell|pwsh|run|exec`
- `network` — `fetch|web_search|browser_|ctx_provider|google_search`

Остальные инструменты (чтение, поиск, `todo`, `subagent`) не ограничиваются: чтение безопасно, а дочерняя сессия наследует ограничения.

## Состояние

Файл на сессию, а не на проект — поэтому блокировки не нужны: пишет только владелец, дочерние сессии и `/matt` только читают.

```json
{
  "version": 1,
  "sessionId": "...",
  "phase": {
    "skill": "grilling",
    "enteredAt": "...",
    "gates": [{ "id": "shared-understanding", "passedAt": null, "evidence": null }],
    "overrides": [{ "gate": "...", "reason": "...", "at": "..." }]
  },
  "history": [{ "skill": "grill-me", "closedAt": "...", "reason": "closed|superseded" }]
}
```

## Дочерние сессии

Если `PI_SUBAGENT_CHILD=1`, расширение не ведёт свою фазу: оно читает файл родителя по `PI_SUBAGENT_PARENT_SESSION` и применяет те же ограничения без права закрывать гейты и менять фазу. Дочерняя сессия без родителя или с нечитаемым файлом работает без ограничений.

## Команды

Одна команда с подкомандами:

```text
/matt            статус: фаза, гейты, что закрыть
/matt goto <s>   принудительная смена фазы, пишется в журнал
/matt override <g> <причина>   обход гейта с причиной
/matt off        выключить до конца сессии
```

## Пакет

- Репозиторий `https://github.com/Ralexxman/pi-matt-x.git` (сейчас пустой, без коммитов).
- `package.json`: имя `pi-matt-x`, конвенциональный каталог `extensions/`, `@earendil-works/pi-coding-agent` в `peerDependencies` с `"*"`.
- Своих зависимостей нет: разбор `SKILL.md` для цитат — регексп, YAML не нужен.
- Установка: `pi install git:github.com/Ralexxman/pi-matt-x@v1`.

## Проверки

`node --test`, чистые функции без Pi:

- `enter` разрешает наследника и отказывает чужому скиллу;
- `decide` блокирует `files`/`commands` при открытом гейте и пропускает при закрытом;
- гейт `artifact` требует файл и дословные заголовки;
- гейт `command` отличает `expect: "zero"` от `"nonzero"`;
- гейт `visited` не закрывается, если `code-review` не открывался;
- обход пишется в `overrides` и снимает блокировку;
- все `quote` находятся в соответствующих `SKILL.md` (тест против дрейфа);
- дочерняя сессия не может закрыть гейт.

Отдельно — живая проверка на установленном пакете по скиллу `verify-pi-package-via-rpc`.

## Не в v1

- **Аудитор.** Проверка, что модель действительно сделала работу по скиллу, требует LLM-вызова, денег и доверия к суждению второй модели. Гейты остаются человеческими, файловыми и командными.
- **Автопродолжение на `agent_settled`.** Модель заканчивает ход, когда задаёт вопрос, — гейт всё равно не откроется без человека. Механизм не нужен.
- **Права на сабагентов по типам.** Дочерние сессии просто наследуют ограничения.
- **Детект дрейфа без запуска тестов.** См. [ADR-0003](../adr/0003-contracts-cite-the-skill.md).

## Ограничения, которые надо помнить

- Гейт `user` закрывается любым сообщением, включая «а что если». Формально это дыра (см. [ADR-0002](../adr/0002-human-gate-is-a-new-message.md)).
- В json/print/RPC нет UI: несправедливый переход пользователя выполняется с записью `superseded/no-ui`.
- Отображение инструментов в возможности — регексп по имени; инструмент с неожиданным именем не ограничивается. `shortcut:`, расширять таблицей в настройках, когда появится чужой инструмент с мутирующим эффектом.
