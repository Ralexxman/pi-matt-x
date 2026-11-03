# Оценка готовности skill-guard как единственного гарда флоу Matt Pocock

Исследование готовности расширения `extensions/skill-guard/` в качестве единственного рубежа контроля над флоу скиллов Matt Pocock. Все выводы и утверждения выверены строго по первоисточникам: исходному коду рантайма Pi 1.4.0 (`@earendil-works/pi-coding-agent`), коду самого расширения, установленным скиллам (`~/.agents/skills/`) и принятым ADR (`docs/adr/`).

---

## 1. Соответствие событий хуков и полезной нагрузки Pi 1.4.0

Все используемые расширением хуки объявлены в API Pi 1.4.0 (`dist/core/extensions/types.d.ts`), однако рантайм имеет тонкие семантические особенности:

- `session_start` (`types.d.ts:576, 1189`): Принимает `SessionStartEvent` (`reason: "startup" | "reload" | "new" | "resume" | "fork"`). В `index.ts:121` аргумент события игнорируется, используется `ctx.cwd` (`types.d.ts:221`) и `ctx.sessionManager.getSessionId()` (`dist/core/session-manager.d.ts:246`). Поддерживается полностью; событие штатно вызывается при `/reload` (`dist/core/agent-session.js:3028`).
- `input` (`types.d.ts:911, 1227`): Принимает `InputEvent` со свойством `text: string` (`types.d.ts:914`). В `index.ts:133` парсится `/skill:name`. Важная деталь рантайма: пользовательские команды расширений (включая `/matt`) перехватываются до событий ввода (`agent-session.js:1636`), тогда как скилл-команды `/skill:*` попадают в `_runInputHandlers` (`agent-session.js:1648`) и раскрываются в промпт только после них (`agent-session.js:1656`). Возврат `void` валиден и трактуется как `{ action: "continue" }` (`dist/core/extensions/runner.js:1229`).
- `tool_call` (`types.d.ts:932, 1224`): Принимает `ToolCallEvent` (`toolName`, `input`, `types.d.ts:980`). В `index.ts:146` перехватываются `read` и мутирующие вызовы; возврат `{ block: true, reason }` соответствует `ToolCallEventResult` (`types.d.ts:1089`). Методы UI `ctx.ui.editor` (`types.d.ts:139`), `ctx.ui.confirm` (`types.d.ts:76`), `ctx.ui.notify` (`types.d.ts:79`) и `ctx.ui.setStatus` (`types.d.ts:84`) полностью соответствуют сигнатурам.
- `tool_result` (`types.d.ts:986, 1225`): Принимает `ToolResultEvent` (`toolName`, `input`, `content`, `isError`, `types.d.ts:994-1025`). В `index.ts:228` проверяются `grantFor === "bash"`, `input.command` и текстовые блоки `content`. Соответствует рантайму.
- `context` (`types.d.ts:680, 1200`): Принимает `ContextEvent` (`messages: AgentMessage[]`), возвращает `{ messages }` (`types.d.ts:1082`). В `index.ts:251` добавляется сообщение `{ role: "custom", customType: "skill-guard", content, display: false }`. `CustomMessage` зарегистрирован в `CustomAgentMessages` (`dist/core/messages.d.ts:53`) и конвертируется функцией `convertToLlm` в `{ role: "user", content }` (`dist/core/messages.js:89`). **Особенность рантайма**: изменение массива сообщений в хуке `context` заставляет `restoreSystemMessages` (`dist/core/extensions/runner.js:101-106`) объединять промежуточные системные сообщения в одно головное.
- `agent_before_settle` (`types.d.ts:798, 1210`): Принимает `AgentBeforeSettleEvent`. В `index.ts:265` возвращает `{ continue: true, entries: [{ type: "custom_message", ... }] }`. В рантайме Pi 1.4.0 драфты коммитятся (`agent-session.js:630, 1575`), после чего проверка `_buildBoundaryContext` (`agent-session.js:597-620`) видит добавленный `custom_message` с ролью `"user"` (не `"assistant"`), поэтому `finalContext.canContinue` принимает значение `true` и продолжение разрешается. Метод `ctx.hasPendingMessages()` присутствует (`types.d.ts:243`).
- `registerCommand` (`types.d.ts:1231`): Регистрирует команду `/matt` с `description`, `getArgumentCompletions` и `handler` (`index.ts:279-320`).
- `getArgumentCompletions` (`types.d.ts:1175`): Возвращает `AutocompleteItem[]` (`value`, `label`, `description`). Поддерживается в TUI (`dist/modes/interactive/interactive-mode.js:528`). **Неподдерживаемое предположение**: в RPC-режиме (`dist/modes/rpc/rpc-mode.js:540-547`) метод `getArgumentCompletions` не вызывается и не передается клиенту через `get_commands`.

---

## 2. Сверка цитат гейтов с установленными скиллами (Drift Check)

Все текстовые цитаты `quote`, зашитые в `contracts.ts`, присутствуют в файлах `SKILL.md` каталога `~/.agents/skills/` дословно и без расхождений:

1. `grilling` (`contracts.ts:51-52`): цитата `"The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed."` точно совпадает с `~/.agents/skills/grilling/SKILL.md:30`.
2. `grill-me` (`contracts.ts:68-69`): ссылается на `source: "grilling"`, делегирующий интервью (`grill-me/SKILL.md:7`); цитата совпадает с `~/.agents/skills/grilling/SKILL.md:30`.
3. `grill-with-docs` (`contracts.ts:81-82`): ссылается на `source: "grilling"`; цитата совпадает с `~/.agents/skills/grilling/SKILL.md:30`.
4. `to-spec` (`contracts.ts:93`): цитата `"Check with the user that these seams match their expectations."` точно совпадает с `~/.agents/skills/to-spec/SKILL.md:17`.
5. `to-tickets` (`contracts.ts:103`): цитата `"Each slice is sized to fit in a single fresh context window"` точно совпадает с `~/.agents/skills/to-tickets/SKILL.md:33`.
6. Остальные контракты (`implement`, `tdd`, `code-review`, `diagnosing-bugs`, `prototype`) пользовательских гейтов не имеют; `implement-spec` использует машинный `command`-гейт без цитаты (`contracts.ts:121-125`).

Текстовый дрейф отсутствует: 3 уникальные цитаты совпадают посимвольно (`contracts.test.ts:27-38`).

---

## 3. Векторы обхода гарда (Bypass Analysis)

| Вектор обхода | Точка в коде | Статус | Механизм и последствия |
| :--- | :--- | :--- | :--- |
| **Ввод `/skill:<name>`** | `index.ts:133-144` | Принято явно | Переключает фазу в обход графа `successors` и без ответа на незакрытый гейт предыдущей фазы. Документировано как осознанное решение: выбор пользователя не ограничивается (`index.ts:130-132`, `docs/adr/0004-enforcement-points.md:18`, `docs/adr/0005-ask-when-unknown.md:18`). |
| **Команда `/matt goto`** | `index.ts:303-317` | Принято явно | Административный сброс фазы человеком (`GLOSSARY.md:32`). Не проверяет граф переходов и не требует закрытия гейта (`index.ts:18, 278`). |
| **Чтение неконтрактного скилла** | `engine.ts:133`, `index.ts:173` | Принято явно | Скилл без контракта доступен для чтения отовсюду, но не меняет текущую фазу (`decide` возвращает `phase: state.phase`). Ограничения открытой фазы сохраняются (`docs/adr/0005-ask-when-unknown.md:16-17`, `index.ts:9-12`). |
| **Неизвестный инструмент** | `engine.ts:120-124`, `index.ts:205-224` | Принято явно | Если фаза разрешает `bash`, неизвестный инструмент пропускается без вопросов (`engine.ts:122`, `docs/adr/0005-ask-when-unknown.md:21-22`). В фазах без `bash` запрашивается `ui.confirm`, а в headless — блокируется (`index.ts:210-215`). |
| **Субагенты `PI_SUBAGENT_CHILD`** | `index.ts` (отсутствует) | **Недокументированная дыра** | В коде расширения полностью отсутствует проверка `PI_SUBAGENT_CHILD` / `PI_SUBAGENT_PARENT_SESSION`, хотя требование заявлено в `docs/design/pi-matt-x.md:121` и `docs/design/implement-spec-control.md:20`. Дочерний агент стартует с чистым состоянием (`phase: null`, `engine.ts:10`) и получает полный неограниченный доступ ко всем инструментам (`bash`, `write`). |
| **Самозакрытие тикетов моделью через `bash`** | `index.ts:228-249`, `contracts.ts:114` | **Недокументированная дыра** | В фазе `implement-spec` модель имеет грант `bash`. Фильтр `tool_result` проверяет лишь `/^\s*gh\s/` и совпадение регулярного выражения `gate.must` (`0|CLOSED`). Модель может выполнить `gh issue close <spec>`, `gh issue close <id>` или команду вида `gh issue list ...; echo 0`, сымитировав закрытие спеки в раннере без реального выполнения работы. |

---

## 4. Пропущенные контракты и деградация графа переходов

В `CONTRACTS` (`contracts.ts:44-150`) определены ровно 11 скиллов. При этом в списках `successors` указаны фазы, не имеющие контрактов:
- `implement` (`contracts.ts:110`): преемники `retro`, `pr`, `handoff` (контрактов нет);
- `implement-spec` (`contracts.ts:118`): преемники `retro`, `pr`, `handoff` (контрактов нет);
- `code-review` (`contracts.ts:137`): преемники `retro`, `pr`, `handoff` (контрактов нет);
- Входные и вспомогательные скиллы флоу `wayfinder`, `ask-matt`, `improve-codebase-architecture`, `setup-matt-pocock-skills` контрактов не имеют вовсе.

### Что ломается из-за отсутствия контрактов

В функции `decide()` (`engine.ts:126-140`):
```ts
if (!contractOf(contracts, req.name)) return { allow: true, phase: state.phase }; // engine.ts:133
if (!c) return { allow: true, phase: req.name };                                  // engine.ts:134
if (c.successors.includes(req.name)) return { allow: true, phase: req.name };     // engine.ts:135
```
1. Строка `engine.ts:133` выполняется **до** проверки `c.successors.includes(req.name)` (`engine.ts:135`).
2. При переходе модели в `pr`, `retro` или `handoff` функция `decide` возвращает `{ allow: true, phase: state.phase }`. Фаза **не меняется** и остается `implement` или `code-review`.
3. Декларация `successors: ["retro", "pr", "handoff"]` является мертворожденным кодом (dead code): эти этапы в принципе невозможно сделать текущей фазой через чтение `SKILL.md`.
4. В результате для фаз `pr` и `retro` невозможно задать и проконтролировать обязательные дисциплинарные требования (структура тела PR из `pr/SKILL.md:16-30`, ретроспективный анализ из `retro/SKILL.md:9-30`).
5. Любой неконтрактный скилл (`wayfinder`, `ask-matt`) открывается из абсолютно любой фазы (даже из `grilling`), так как строка `engine.ts:133` безусловно разрешает чтение.

---

## 5. Анализ покрытия тестами критических путей

При аудите тестового набора (`contracts.test.ts`, `engine.test.ts`, `index.test.ts`, `state.test.ts`) выявлены следующие пробелы:

1. **Ветви `hasUI === false` (`index.ts:187, 200, 210`)**: **Тестов нет**. В тест-харнесе `index.test.ts:47` жестко зашит флаг `hasUI: true`. Поведение тихого пропуска гейтов и блокировки неизвестных инструментов в headless-режиме не тестируется.
2. **Обработка `saveError` (`index.ts:49-51, 96`)**: **Тестов нет**. Ошибки сохранения состояния на диск и вывод сообщения `состояние НЕ сохранено` в `/matt` не эмулируются ни в одном тесте.
3. **Очередь сообщений `hasPendingMessages` (`index.ts:269`)**: **Тестов нет**. В `index.test.ts:47` задана заглушка `hasPendingMessages: () => false`. Подавление продолжения при наличии входящих сообщений в очереди не проверяется.
4. **Сбои файловой персистентности сессии (`state.ts:50-54`, `index.ts:32-37`)**: **Частично**. Поврежденный JSON при чтении покрыт (`state.test.ts:25`), но падения при записи `writeState` (нет прав, переполнение диска) не тестируются.
5. **`tool_result` с отличной от `gh` командой (`index.ts:233`)**: **Покрыто тестом**. В `index.test.ts:308` проверяется команда `printf 0`, а в `index.test.ts:316` — результат инструмента `read`.
6. **`/skill:` с неконтрактным именем (`index.ts:138`)**: **Покрыто тестом**. В `index.test.ts:184-189` проверен ввод `/skill:domain-modeling` при открытой `to-spec`, в `index.test.ts:191-197` — опечатка `/skill:implemet`. Старт с неконтрактного скилла на чистом состоянии отдельно не выделен, но логика идентична.

---

## 6. Вердикт и первоочередные задачи

### Вердикт: NOT-READY (не готово в качестве единственного гарда)

Расширение демонстрирует качественную чистую архитектуру ядра (`engine.ts`), надежный механизм переживания сжатия контекста через инъекцию блока в хуке `context` (`index.ts:251`) и корректную реализацию автопродолжения через драфты `agent_before_settle` (`index.ts:265`). Однако в качестве **единственного** рубежа защиты расширение не готово, поскольку критические части флоу могут молча проскакивать без контроля.

### Топ-3 первоочередных исправления

1. **Изоляция и наследование для субагентов (`PI_SUBAGENT_CHILD`)**  
   *Где*: `index.ts:session_start`, `engine.ts`.  
   *Суть*: Реализовать чтение файла состояния родительской сессии по `PI_SUBAGENT_PARENT_SESSION` при наличии флага `PI_SUBAGENT_CHILD=1` (`docs/design/pi-matt-x.md:121`). Запретить дочерним агентам стартовать в режиме cold-start без ограничений и не позволять им закрывать гейты родителя. Без этого воркеры в `implement-spec` полностью бесконтрольны.
2. **Добавление контрактов для терминальных фаз (`pr`, `retro`, `handoff`) и исправление `decide()`**  
   *Где*: `contracts.ts`, `engine.ts:133-136`.  
   *Суть*: Завести контракты для `pr`, `retro`, `handoff`. В `engine.ts` поменять порядок проверок: если скилл указан в `c.successors`, он обязан переключать фазу, даже если у него пока нет собственного гейта. Сейчас строка `engine.ts:133` отвечает раньше проверки `successors`, и фаза молча остаётся прежней.
3. **Защита command-гейта от самозакрытия моделью через `bash`**  
   *Где*: `index.ts:231-236`, `engine.ts:specCheck`.  
   *Суть*: В фазе `implement-spec` разрешать закрытие гейта только по точной верифицирующей команде чтения статуса (например, `gh issue view ... --json state`), запретив закрывать гейт командами мутации (`gh issue close`) или композитными вызовами bash (`&&`, `;`, `echo`).
