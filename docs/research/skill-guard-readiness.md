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

Текстовый дрейф отсутствует: 8 пользовательских гейтов содержат 6 уникальных цитат (одна цитата `grilling` служит трём контрактам), и все они совпадают посимвольно (`contracts.test.ts:27-38`).

---

## 3. Векторы обхода гарда (Bypass Analysis)

| Вектор обхода | Точка в коде | Статус | Механизм и последствия |
| :--- | :--- | :--- | :--- |
| **Ввод `/skill:<name>`** | `index.ts:133-144` | Принято явно | Переключает фазу в обход графа `successors` и без ответа на незакрытый гейт предыдущей фазы. Документировано как осознанное решение: выбор пользователя не ограничивается (`index.ts:130-132`, `docs/adr/0004-enforcement-points.md:18`, `docs/adr/0005-ask-when-unknown.md:18`). |
| **Команда `/matt goto`** | `index.ts:303-317` | Принято явно | Административный сброс фазы человеком (`GLOSSARY.md:32`). Не проверяет граф переходов и не требует закрытия гейта (`index.ts:18, 278`). |
| **Чтение неконтрактного скилла** | `engine.ts:133`, `index.ts:173` | Принято явно | Скилл без контракта доступен для чтения отовсюду, но не меняет текущую фазу (`decide` возвращает `phase: state.phase`). Ограничения открытой фазы сохраняются (`docs/adr/0005-ask-when-unknown.md:16-17`, `index.ts:9-12`). |
| **Неизвестный инструмент** | `engine.ts:120-124`, `index.ts:205-224` | Принято явно | Если фаза разрешает `bash`, неизвестный инструмент пропускается без вопросов (`engine.ts:122`, `docs/adr/0005-ask-when-unknown.md:21-22`). В фазах без `bash` запрашивается `ui.confirm`, а в headless — блокируется (`index.ts:210-215`). |
| **Субагенты `PI_SUBAGENT_CHILD`** | `parentFile()`, `session_start`, `tool_call`, `tool_result`, `/matt` в `index.ts` | **Закрыто (cf91d2b)** | При `PI_SUBAGENT_CHILD=1` и `PI_SUBAGENT_PARENT_SESSION=<id>` ребёнок читает файл родителя и не пишет своего: `commit()` не вычисляет файл, `/matt goto` и `/matt spec` отказывают, `/skill:` и чтение чужого `SKILL.md` не меняют фазу, `tool_result` не закрывает гейт родителя. Проверено тестами и живым RPC. |
| **Самозакрытие тикетов моделью через `bash`** | `engine.ts:trackerRead`, `index.ts:tool_result` | **Закрыто (97e5885, afb8b0f)** | Гейт закрывает только одиночная read-only команда `gh issue view` или `gh issue list` без `;`, `&&`, `|`, `>` и подстановок. `gh issue close`, `gh issue edit`, `gh issue list; echo 0` и `gh api …` гейт не закрывают — проверено тестами и живой сессией. Осталось: модель может закрыть тикет любым способом, а потом честно прочитать `0`; это данные трекера, а не подлог. |

---

## 4. Пропущенные контракты и деградация графа переходов

### Как было в первой редакции

В `CONTRACTS` было 11 контрактов, а в списках `successors` стояли фазы без контрактов: `implement` (`contracts.ts:110`), `implement-spec` (`contracts.ts:118`) и `code-review` (`contracts.ts:137`) объявляли `retro`, `pr`, `handoff`, которых в таблице не было. Сейчас в таблице 14 контрактов. Входные и вспомогательные скиллы (`wayfinder`, `ask-matt`, `improve-codebase-architecture`, `setup-matt-pocock-skills`) контрактов не имеют и сейчас — они не фазы флоу.

### Как было в первой редакции (порядок проверок)

```ts
// ответ «нет контракта» приходил раньше проверки successors
if (!contractOf(contracts, req.name)) return { allow: true, phase: state.phase };
if (!c) return { allow: true, phase: req.name };
if (c.successors.includes(req.name)) return { allow: true, phase: req.name };
```

Следствие: переход в `pr`, `retro` или `handoff` возвращал `{ allow: true, phase: state.phase }` — фаза не менялась, объявление в `successors` было мёртвым кодом, а дисциплинарные требования этих шагов проверить было нечем.

### Исправлено в `42ff606`

У `pr`, `retro` и `handoff` есть контракты с грантами, наследниками и цитатой из своего `SKILL.md` (цитаты сверяет `contracts.test.ts`). В `decide()` проверка `c.successors.includes(req.name)` теперь идёт **до** проверки отсутствия контракта: объявленный наследник становится фазой, даже если своего гейта у него ещё нет. `handoff` — единственный конец флоу, и инвариант в `engine.test.ts` говорит это явно: ровно один контракт без наследников, и это он.

---

## 5. Анализ покрытия тестами критических путей

При аудите тестового набора (`contracts.test.ts`, `engine.test.ts`, `index.test.ts`, `state.test.ts`) выявлены следующие пробелы:

1. **Ветви `hasUI === false` (`index.ts:187, 200, 210`)**: **Тестов нет**. В тест-харнесе `index.test.ts:47` жестко зашит флаг `hasUI: true`. Поведение тихого пропуска гейтов и блокировки неизвестных инструментов в headless-режиме не тестируется.
2. **Обработка `saveError` (`index.ts:49-51, 96`)**: **Тестов нет**. Ошибки сохранения состояния на диск и вывод сообщения `состояние НЕ сохранено` в `/matt` не эмулируются ни в одном тесте.
3. **Очередь сообщений `hasPendingMessages` (`index.ts:269`)**: **Тестов нет**. В `index.test.ts:47` задана заглушка `hasPendingMessages: () => false`. Подавление продолжения при наличии входящих сообщений в очереди не проверяется.
4. **Сбои файловой персистентности сессии (`state.ts:50-54`, `index.ts:32-37`)**: **Частично**. Поврежденный JSON при чтении покрыт (`state.test.ts:25`), но падения при записи `writeState` (нет прав, переполнение диска) не тестируются.
5. **`tool_result` с отличной от `gh` командой (`index.ts:233`)**: **Покрыто тестом**. В `index.test.ts:308` проверяется команда `printf 0`, а в `index.test.ts:316` — результат инструмента `read`.
6. **`/skill:` с неконтрактным именем (`index.ts:138`)**: **Покрыто тестом**. В `index.test.ts:184-189` проверен ввод `/skill:domain-modeling` при открытой `to-spec`, в `index.test.ts:191-197` — опечатка `/skill:implemet`. Старт с неконтрактного скилла на чистом состоянии отдельно не выделен, но логика идентична.

### Закрыто в `0c7e375`

Пункты 1–4 (ветви `hasUI === false` во всех трёх местах, `saveError` с недоступным путём записи, `hasPendingMessages`, падение `writeState`) покрыты тестами. Набор — 78 тестов, 0 падений; `npx tsc --noEmit` — 0.

---

## 6. Вердикт и первоочередные задачи

### Вердикт: READY-WITH-CAVEATS (готово к ежедневной работе под присмотром человека)

Три дыры из первой редакции закрыты: сабагенты наследуют фазу и не могут её сдвинуть (`cf91d2b`), последние шаги флоу стали фазами (`42ff606`), гейт закрывает только чтение трекера (`97e5885`), все ранее непокрытые ветки под тестами (`0c7e375`). Ядро (`engine.ts`) остаётся чистым и глубоким, блок фазы переживает сжатие, персистентность и `/reload` — проверены вживую.

### Что осознанно остаётся

1. **Модель может сделать данные трекера правдой**: закрыть тикет `gh issue close` и затем прочитать `0`. Гейт больше не закрывается подлогом, но он верит трекеру, а не проверяет, что работа сделана. Это граница дизайна, а не недосмотр.
2. **`/matt override <gate> <reason>`** из `GLOSSARY.md` («Обход») не реализован: человек может только сменить фазу через `/matt goto`, без записанной причины.
3. **Автодополнение аргументов `/matt` не работает в RPC-режиме** (`rpc-mode.js:540-547` не передаёт `getArgumentCompletions` клиенту); в TUI работает (`interactive-mode.js:528`).

### Первоначальный топ-3 (история, все три закрыты)

1. **Изоляция и наследование для субагентов (`PI_SUBAGENT_CHILD`)**  
   *Где*: `index.ts:session_start`, `engine.ts`.  
   *Суть*: Реализовать чтение файла состояния родительской сессии по `PI_SUBAGENT_PARENT_SESSION` при наличии флага `PI_SUBAGENT_CHILD=1` (`docs/design/pi-matt-x.md:121`). Запретить дочерним агентам стартовать в режиме cold-start без ограничений и не позволять им закрывать гейты родителя. Без этого воркеры в `implement-spec` полностью бесконтрольны.
2. **Добавление контрактов для терминальных фаз (`pr`, `retro`, `handoff`) и исправление `decide()`**  
   *Где*: `contracts.ts`, `engine.ts:133-136`.  
   *Суть*: Завести контракты для `pr`, `retro`, `handoff`. В `engine.ts` поменять порядок проверок: если скилл указан в `c.successors`, он обязан переключать фазу, даже если у него пока нет собственного гейта. Сейчас строка `engine.ts:133` отвечает раньше проверки `successors`, и фаза молча остаётся прежней.
3. **Защита command-гейта от самозакрытия моделью через `bash`**  
   *Где*: `index.ts:231-236`, `engine.ts:specCheck`.  
   *Суть*: В фазе `implement-spec` разрешать закрытие гейта только по точной верифицирующей команде чтения статуса (например, `gh issue view ... --json state`), запретив закрывать гейт командами мутации (`gh issue close`) или композитными вызовами bash (`&&`, `;`, `echo`).
