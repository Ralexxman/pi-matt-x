# Аудит skill-guard: что проверили и чем кончилось

Независимый аудит (reviewer, чистый контекст) против первичных источников: ядро Pi 1.4.0
(`dist/core/extensions/*`, `dist/core/tools/*`, `dist/core/agent-session.js`) и сами
`SKILL.md` в `C:/Users/ralex/.agents/skills/`. Ниже — каждое утверждение и его судьба.

## Подтвердилось и исправлено

| Находка | Доказательство | Правка |
| --- | --- | --- |
| `grill-with-docs` не мог запустить свой шаг `grilling` — документированная процедура блокировалась | `grill-with-docs/SKILL.md:7` «Call the Skill tool twice, for "grilling" and "domain-modeling"» | `grilling` добавлен в наследники; под-скиллы не считаются границей фазы (`SUB_SKILLS`) |
| `to-tickets` не мог записать тикеты | `to-tickets/SKILL.md:62` «write one file per ticket under `.scratch/<feature-slug>/issues/…`» | грант `write` |
| Запрет `bash` обходился другим именем тула | `dist/core/tools/*.js`: `bash, edit, find, grep, ls, powershell, read, write`; плюс тулы расширений (`pwsh`, `codemode`, `subagent`, `workflow`) | единый `EXEC_TOOLS` + тест |
| `/skill:name` не включал охрану | `dist/core/agent-session.js:1654` «Emit input event … before skill/template expansion» | обработчик `input` |
| Чтение скилла без контракта снимало все ограничения | `decide()`, ветка `skill` | фаза больше не меняется |
| Неизвестный тул молча разрешался | `grantFor()` → `null` | диалог `ctx.ui.confirm`, один ответ на пару «фаза:тул» |

## Отклонено как неверное

- **«`tdd` — тупик, нельзя вернуться в `implement`».** `tdd/SKILL.md:38`: «Refactoring is not
  part of the loop. It belongs to the review stage (see the `code-review` skill)». Переход
  `tdd → code-review` и есть то, что предписывает скилл.

## Принято как известный предел, не баг

- **Порядок между скрытыми скиллами держит пользователь.** Pi сам убирает из промпта скиллы
  с `disable-model-invocation: true` (`formatSkillsForPrompt`), поэтому 23 из 33 скиллов
  модель открыть не может — их вызывает `/skill:name`, и это осознанный вход в фазу.
- **Гейты не выражают «сначала красная команда»** — в контракте нет поля для наблюдаемого условия.

## Проверка после правок

`npx tsc --noEmit` — чисто; `node --test extensions/skill-guard/*.test.ts` — 26 тестов, 0 падений.
Живой прогон в Pi не делался.
