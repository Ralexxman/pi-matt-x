# Архитектура и формализация флоу скиллов Matt Pocock

Документ содержит формализацию локально установленного набора скиллов Matt Pocock (`~/.agents/skills/` и `~/.pi/agent/skills/`), извлеченную исключительно из первоисточников (`SKILL.md`, вспомогательных спецификаций `*.md`, шаблонов скриптов и манифестов субагентов). Назначение — служить спецификацией для Pi-расширения, механически удерживающего модель внутри канонического флоу.

---

## 1. Пайплайн

### Схема основного потока и точек входа

```text
[Предусловие] setup-matt-pocock-skills (однократно: трекер, метки, доменная разметка)
                      │
   ┌──────────────────┴────────────────────────┬──────────────────────────────────┐
   ▼                                           ▼                                  ▼
[Входящие баги/запросы]               [Идея / Новая фича]               [Сложные баги / Регрессии]
      /triage                                  │                             /diagnosing-bugs
(needs-triage ➔ ready-for-agent)               │                        (1-cmd tight red loop ➔ fix)
   │                                           │                                  │
   │   ┌───────────────────────────────────────┴──────────────────────────────┐   │
   │   │                                                                      │   │
   │   ▼                                                                      ▼   ▼
   │ [Большая / туманная цель]                                       [Обычная фича / задача]
   │       /wayfinder                                                   /grill-with-docs
   │ (карта wayfinder:map ➔ тикеты)                                      (или /grill-me)
   │   │                                                                      │
   │   └───────────────────────────────┬──────────────────────────────────────┘
   │                                   │
   │                    [Нужен исполняемый ответ?]
   │                     ├── Да  ➔ /handoff ➔ /prototype (branch prototype/*) ➔ /handoff
   │                     └── Нет ──────────────────────────┐
   │                                                       ▼
   │                                        [Многосессионная сборка?]
   │                                         ├── Да  ➔ /to-spec ➔ /to-tickets
   │                                         │              │
   │                                         │              ├── Потикетно: /implement (/clear между тикетами)
   │                                         │              └── Граф/пакет: /implement-spec (оркестратор subagents)
   │                                         └── Нет ➔ /implement (в том же контексте)
   │                                                       │
   └───────────────────────────────────────────────────────┼──────────────────────┐
                                                           ▼                      │
                                                  Реализация: /tdd                │
                                                  (red-green на швах)             │
                                                           │                      │
                                                           ▼                      │
                                                     /code-review                 │
                                              (двухосевой: Standards + Spec)      │
                                                           │                      │
                                                           ▼                      │
                                                     /pr (pull request)           │
                                                           │                      │
                                                           ▼                      ▼
                                                         /retro ──────────► /improve-codebase-architecture
                                                 (тюнинг окружения)         (deepening opportunities)
```

### Канонические переходы и триггеры

- **Предусловие**: `setup-matt-pocock-skills` запускается один раз: *"Configure this repo for the engineering skills: set up its issue tracker, triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills."* (`setup-matt-pocock-skills/SKILL.md:2-3`).
- **Старт идеи**: `grill-with-docs`: *"Start here whenever you are working in a working directory: it's stateful, retaining what it learns in GLOSSARY.md and ADRs. (No working directory? Use /grill-me instead...)"* (`ask-matt/SKILL.md:14-16`). Запускает примитив `grilling` и дисциплину `domain-modeling`.
- **Ветвление на прототип**: *"Can you settle every question in conversation? If a question needs a runnable answer (state, business logic, a UI you have to see), detour through a prototype, bridged by /handoff in both directions... prototype to answer the question with throwaway code, /handoff back what you learned..."* (`ask-matt/SKILL.md:17-21`).
- **Ветвление на декомпозицию**:
  - *Многосессионный билд*: `to-spec` синтезирует разговор в спеку (`ask-matt/SKILL.md:23`), затем `to-tickets`: *"Break a plan, spec, or conversation into a set of tickets: tracer-bullet vertical slices, each declaring the tickets that block it."* (`to-tickets/SKILL.md:10`).
  - *Исполнение потикетно*: `/implement` per ticket с очисткой контекста: *"/implement per ticket, /clearing context between each one."* (`ask-matt/SKILL.md:24`).
  - *Исполнение пакетом*: `/implement-spec`: *"Implement the result of /to-spec and /to-tickets in code... orchestrate the build than drive each ticket yourself."* (`implement-spec/SKILL.md:2`, `ask-matt/SKILL.md:26`).
- **Сборка и проверка**: Вне зависимости от пути код строится через `tdd` и проверяется через `code-review`: *"Either way, the code gets built by driving /tdd (one red-green slice at a time) and closes out with /code-review, a two-axis review (Standards + Spec) of the diff."* (`ask-matt/SKILL.md:29-30`).
- **Оформление сдачи**: `/pr` вызывается моделью автоматически при создании pull request: *"When the work goes up as a pull request, /pr shapes the body... It's model-invoked, so the agent reaches for it whenever it writes a PR."* (`ask-matt/SKILL.md:33-35`).
- **Замыкание цикла**: `/retro`: *"After a build, and especially one that went sideways, it looks back over the session and suggests changes to the agent's environment, not the code... The next build then starts from a better environment."* (`ask-matt/SKILL.md:37-41`).
- **Вход багов (On-ramp triage)**: `triage`: *"Bugs and requests piling up → /triage. It moves issues through triage roles and produces agent-ready issues, which /implement later picks up. Triage is only for issues you didn't create... Tickets that /to-tickets produced are already agent-ready, so don't triage them."* (`ask-matt/SKILL.md:52-55`).
- **Вход сложной диагностики**: `diagnosing-bugs`: *"Something's broken → /diagnosing-bugs... It refuses to theorise until it has a tight feedback loop... Once the fix is in, run /retro in the same session... where the real finding is that there's no good seam to lock it down, that's a job for /improve-codebase-architecture."* (`ask-matt/SKILL.md:57-61`).
- **Вход туманных инициатив**: `wayfinder`: *"When the way from here to the destination isn't visible yet, it charts a shared map of decision tickets... produces decisions, not deliverables... When the map clears, it hands off, it doesn't build: merge onto the main flow at /to-spec..."* (`ask-matt/SKILL.md:63-68`).
- **Уход за кодовой базой**: `improve-codebase-architecture`: *"surfaces deepening opportunities; picking one generates an idea you can take into the main flow at /grill-with-docs... codebase-design is the bench you design the chosen one on."* (`ask-matt/SKILL.md:73-75`).

---

## 2. Этапы и exit criteria

| Скилл / Этап | Что должно быть на выходе (exit criteria) | Проверяемо машинно | Источник |
| :--- | :--- | :--- | :--- |
| **setup-matt-pocock-skills**<br>Настройка репозитория | Созданы файлы `docs/agents/issue-tracker.md`, `domain.md`, `triage-labels.md` (при наличии triage); в `AGENTS.md` или `CLAUDE.md` добавлен/обновлен блок `## Agent skills`. | **Да** (наличие файлов, секций и совпадение меток трекера) | `setup-matt-pocock-skills/SKILL.md:46-77` |
| **grilling**<br>Допрос / интервью | Фронтир вопросов пуст (`frontier is empty`); пользователь явно подтвердил общее понимание (`user confirms you have reached a shared understanding`). Никаких промежуточных действий по коду не предпринято. | **Частично** (пустой фронтир анализируется текстово; подтверждение пользователя ловится парсером диалога) | `grilling/SKILL.md:6-31` |
| **domain-modeling**<br>Формирование модели | Термины синхронно внесены в `GLOSSARY.md` (строго без деталей реализации, с секциями `_Avoid_`); при соблюдении 3 критериев создан файл `docs/adr/NNNN-<slug>.md`. | **Да** (валидация структуры `GLOSSARY.md` и наличия файлов в `docs/adr/`) | `domain-modeling/SKILL.md:27-53` |
| **prototype**<br>Быстрый прототип | Создана ветка `prototype/<name>`; получен артефакт: автономный HTML-файл для логики (`LOGIC.md:18`) либо UI-роут с селектором через query-параметр и нижней панелью (`UI.md:20`); ссылка на ветку привязана к issue. | **Да** (наличие git-ветки, HTML-файла или роута с UI-переключателем) | `prototype/SKILL.md:8-28` |
| **to-spec**<br>Синтез спецификации | Спецификация опубликована в issue tracker (или `.scratch/<feature>/spec.md`) строго по шаблону (Problem Statement, Solution, User Stories, Impl Decisions, Testing Decisions, Out of Scope, Further Notes); швы согласованы с пользователем; установлена метка `ready-for-agent`. | **Да** (наличие issue/файла, проверка всех 7 обязательных заголовков и метки) | `to-spec/SKILL.md:13-21` |
| **to-tickets**<br>Декомпозиция на тикеты | Созданы tracer-bullet тикеты с blocking edges: либо файлы `.scratch/<feature>/issues/<NN>-<slug>.md`, либо issues в трекере в топологическом порядке; пользователь утвердил разбивку; проставлена метка `ready-for-agent`. Родительские issue не изменены. | **Да** (наличие файлов/issue, парсинг поля `Blocked by`, статус `ready-for-agent`) | `to-tickets/SKILL.md:21-57` |
| **implement**<br>Прямая реализация | Выбранный тикет реализован через `/tdd`; выполнен typecheck и тесты; вызван `/code-review`; сделан коммит в текущую ветку. | **Частично** (наличие коммита и статус тестов проверяемы; вызов скиллов контролируется логом) | `implement/SKILL.md:7-17` |
| **implement-spec**<br>Пакетная реализация | Создана ветка `integration`; открыт draft PR; запущены `implementer subagents` в изолированных git worktree; каждый прогнал `/tdd`; `merger subagent` влил ветки; выполнен `/code-review`; worktree очищены; тикеты закрыты. | **Да** (ветка `integration`, закрытие тикетов, удаление worktree каталогов, draft PR) | `implement-spec/SKILL.md:19-39` |
| **tdd**<br>Разработка через тесты | Швы предварительно согласованы с пользователем; сначала написан падающий тест (Red); написан минимальный код до прохождения (Green); рефакторинг не выполнялся внутри цикла. | **Да** (тест коммитится/запускается до кода с кодом возврата != 0, затем == 0) | `tdd/SKILL.md:19-36` |
| **code-review**<br>Двухосевое ревью | `git rev-parse` валиден, диф не пуст; параллельно отработали два сабагента (`Standards` и `Spec`), каждый выдал отчет `<400` слов; отчеты выведены бок о бок без слияния и без общего переранжирования. | **Да** (непустой git diff; наличие секций `## Standards` и `## Spec` в выводе) | `code-review/SKILL.md:20-76` |
| **triage**<br>Триаж заявок | Добавлен обязательный дисклеймер AI; назначены ровно 1 категория и 1 статус; проверены redundancy и `.out-of-scope/`; баг воспроизведен / PR проверен; для `ready-for-agent` добавлен Agent Brief; для отклоненных фич создан `.out-of-scope/<concept>.md`. | **Да / Частично** (дисклеймер, метки issue, структура Agent Brief проверяемы парсером) | `triage/SKILL.md:14-72`, `triage/AGENT-BRIEF.md:36-60` |
| **diagnosing-bugs**<br>Диагностика багов | Фаза 1: зафиксирована 1 команда детерминированного red loop (запущена, вывод красен); Фаза 2: репро минимизирован; Фаза 3: сгенерировано 3-5 гипотез; Фаза 4: логи с префиксом `[DEBUG-...]`; Фаза 5: регрессионный тест на шве до фикса; Фаза 6: тест зелен, логи удалены. | **Да / Частично** (выполнение команды red-loop, прогон теста, проверка `grep` на отсутствие `[DEBUG-]`) | `diagnosing-bugs/SKILL.md:18-118` |
| **wayfinder**<br>Картирование тумана | Создан issue `wayfinder:map` (Destination, Notes, Decisions so far, Not yet specified, Out of scope); созданы дочерние тикеты `wayfinder:<type>`; в сессии разрешается строго 1 тикет; результат оформлен как решение в комментарии; тикет закрыт; обновлен map. | **Да** (метки `wayfinder:*`, структура тела карты, закрытие ровно 1 тикета за сессию) | `wayfinder/SKILL.md:12-102` |
| **improve-codebase-architecture** | Анализ hot spots по git log; сгенерирован HTML-отчет в temp (`<tmpdir>/architecture-review-*.html`, Tailwind+Mermaid); интерфейсы ДО выбора кандидата НЕ предлагаются; выбранный кандидат отправлен в `grilling`. | **Да** (существование HTML в `$TMPDIR`, валидация разметки) | `improve-codebase-architecture/SKILL.md:21-65` |
| **pr**<br>Оформление PR | Тело PR содержит ровно три обязательных секции: `## Summary` (визуализация/дерево/псевдокод), `## Evidence` (Before/After), `## Merge Danger` (Door, Blast Radius). | **Да** (валидация Markdown-заголовков в теле pull request через `gh pr view`) | `pr/SKILL.md:16-30` |
| **retro**<br>Ретроспектива | Проанализированы первичные логи сессии; сформированы предложения по 7 категориям (Navigation, Checks, Standards, AGENTS.md, Tool economy, No-ops, Access); предложения ранжированы по важности. | **Частично** (текстовая структура отчета, ссылки на реальные файлы стандартов) | `retro/SKILL.md:9-30` |
| **impl-validator**<br>Валидация реализации | На входе получен блок `impl-validator check:`; выполнены проверки существования, полноты, корректности, конвенций; выведена таблица проверок со статусами PASS/WARN/FAIL и итоговый вердикт. | **Да** (строгий формат таблицы и вердикта PASS / WARN / FAIL) | `impl-validator/SKILL.md:18-76` |
| **to-questionnaire**<br>Опросник эксперту | Создан файл `to-questionnaire-<slug>.md` с разделами Purpose, From, To, How answers used, Context, How to answer, тематическими блоками вопросов с заглушками для ответов `>` и блоком Anything else?. | **Да** (проверка создания файла и его структуры) | `to-questionnaire/SKILL.md:16-48` |
| **teach**<br>Обучение | В каталоге созданы `MISSION.md`, `RESOURCES.md`, уроки `./lessons/NNNN-*.html`, записи `./learning-records/NNNN-*.md`, справочники `./reference/*.html`, общие компоненты `./assets/*`. | **Да** (проверка путей, нумерации и формата markdown/html) | `teach/SKILL.md:12-25` |

---

## 3. Дисциплинарные императивы

Дословные цитаты из первоисточников с указанием точных правил поведения («DO NOT», «STOP», «WAIT», «NEVER», «MUST»):

### `grilling`
- `grilling/SKILL.md:27`: *"Finding facts is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself."*
- `grilling/SKILL.md:29`: *"The decisions are the user's: put each to them and wait."*
- `grilling/SKILL.md:31`: *"The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding."*

### `to-spec`
- `to-spec/SKILL.md:7`: *"Do NOT interview the user; just synthesize what you already know."*
- `to-spec/SKILL.md:9`: *"The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`."*
- `to-spec/SKILL.md:17`: *"Check with the user that these seams match their expectations."*
- `to-spec/SKILL.md:46`: *"Do NOT include specific file paths or code snippets. They may end up being outdated very quickly."*

### `to-tickets`
- `to-tickets/SKILL.md:46`: *"Iterate until the user approves the breakdown."*
- `to-tickets/SKILL.md:57`: *"Do NOT close or modify any parent issue."*
- `to-tickets/SKILL.md:91`: *"avoid specific file paths or code snippets: they go stale fast."*

### `tdd`
- `tdd/SKILL.md:19-20`: *"Test only at pre-agreed seams. Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam."*
- `tdd/SKILL.md:34`: *"Red before green. Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features."*
- `tdd/SKILL.md:36`: *"Refactoring is not part of the loop. It belongs to the review stage (see the code-review skill), not the red → green implementation cycle."*

### `code-review`
- `code-review/SKILL.md:25`: *"Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here, not inside two parallel sub-agents."*
- `code-review/SKILL.md:76`: *"Do not merge or rerank findings, because the two axes are deliberately separate (see Why two axes)."*

### `triage`
- `triage/SKILL.md:14-16`: *"Every comment or issue posted to the issue tracker during triage must start with this disclaimer: `> *This was generated by AI during triage.*`"*
- `triage/SKILL.md:39`: *"Every triaged issue should carry exactly one category role and one state role. If state roles conflict, flag it and ask the maintainer before doing anything else."*
- `triage/SKILL.md:60`: *"Before any grilling, check that the claim holds up."*
- `triage/OUT-OF-SCOPE.md:54`: *"Only when an enhancement (not a bug) is rejected as wontfix."*
- `triage/OUT-OF-SCOPE.md:56`: *"Do not write here when something is closed as wontfix because it's already implemented."*

### `diagnosing-bugs`
- `diagnosing-bugs/SKILL.md:14`: *"Redact every secret first: write `<REDACTED>` in its place."*
- `diagnosing-bugs/SKILL.md:52`: *"Do not proceed to hypothesise without a loop."*
- `diagnosing-bugs/SKILL.md:58-61`: *"If you catch yourself reading code to build a theory before this command exists, stop: jumping straight to a hypothesis is the exact failure this skill prevents. No red-capable command, no Phase 2."*
- `diagnosing-bugs/SKILL.md:73`: *"Do not proceed until you have reproduced and minimised."*
- `diagnosing-bugs/SKILL.md:90`: *"Change one variable at a time."*
- `diagnosing-bugs/SKILL.md:97`: *"Tag every debug log with a unique prefix, e.g. `[DEBUG-a4f2]`."*
- `diagnosing-bugs/SKILL.md:103`: *"Write the regression test before the fix, but only if there is a correct seam for it."*
- `diagnosing-bugs/SKILL.md:108`: *"If no correct seam exists, that itself is the finding."*

### `wayfinder`
- `wayfinder/SKILL.md:12`: *"produce decisions, not deliverables"*
- `wayfinder/SKILL.md:16`: *"refer to it by that name, never by a bare id, number, or slug"*
- `wayfinder/SKILL.md:44`: *"wayfinder: labels are the only labels a map and its tickets carry, never a triage label like ready-for-agent: they are decisions, not implementation work."*
- `wayfinder/SKILL.md:46`: *"A session claims a ticket by assigning it to the dev driving the map, first, before any work, so concurrent sessions skip it."*
- `wayfinder/SKILL.md:79`: *"never resolve more than one ticket per session, with the exception of research tickets."*
- `wayfinder/SKILL.md:87`: *"If this surfaces no fog... you don't need a map. Stop and ask the user how they'd like to proceed."*

### `improve-codebase-architecture`
- `improve-codebase-architecture/SKILL.md:12`: *"Use these terms exactly in every suggestion, and don't drift into 'component,' 'service,' 'API,' or 'boundary.'"*
- `improve-codebase-architecture/SKILL.md:57`: *"Do NOT propose interfaces yet. After the file is written, ask the user: 'Which of these would you like to explore?'"*

### `domain-modeling`
- `domain-modeling/SKILL.md:43`: *"update GLOSSARY.md right there. Don't batch these up: capture them as they happen."*
- `domain-modeling/SKILL.md:45`: *"GLOSSARY.md should be totally devoid of implementation details. Do not treat GLOSSARY.md as a spec, a scratch pad, or a repository for implementation decisions."*
- `domain-modeling/SKILL.md:49-53`: *"Only offer to create an ADR when all three are true: 1. Hard to reverse... 2. Surprising without context... 3. The result of a real trade-off... If any of the three is missing, skip the ADR."*

### `setup-matt-pocock-skills`
- `setup-matt-pocock-skills/SKILL.md:46`: *"Never create AGENTS.md when CLAUDE.md already exists (or vice versa); always edit the one that's already there."*

### `handoff`
- `handoff/SKILL.md:8`: *"Save to the temporary directory of the user's OS ($TMPDIR, else /tmp; %TEMP% on Windows) - not the current workspace."*
- `handoff/SKILL.md:12-14`: *"Do not duplicate content already captured in other artifacts... Redact any sensitive information..."*

---

## 4. Где держится только на промпте

Список критических уязвимостей флоу, где поведение опирается исключительно на послушность LLM и требует механических барьеров в Pi-расширении:

1. **`grilling` ➔ Преждевременная реализация**: Модель начинает писать код или предлагать правки до исчерпания фронтира вопросов и подтверждения пользователем (`grilling/SKILL.md:31`). В промпте стоит запрет, но тулы `write`/`edit` остаются доступны.
2. **`diagnosing-bugs` ➔ Теоретизирование до red-loop**: Модель начинает читать код, строить гипотезы и вносить правки без создания детерминированной красной команды (`diagnosing-bugs/SKILL.md:58-61`). Нет барьера, запрещающего редактирование до фиксации красного вывода.
3. **`tdd` ➔ Код без падающего теста и несогласованные швы**: Модель пишет реализацию одновременно с тестом или до теста, минуя фазу проверки красного статуса (`tdd/SKILL.md:34`), а также выбирает внутренние методы вместо публичных швов (`tdd/SKILL.md:19`).
4. **`to-spec` / `to-tickets` ➔ Переход к работе без аппрува**: Модель формулирует спеку/тикеты и сразу же переходит к вызову `implement`, не дожидаясь подтверждения швов (`to-spec/SKILL.md:17`) и разбивки задач (`to-tickets/SKILL.md:46`).
5. **`implement-spec` ➔ Коллапс оркестрации**: Модель сворачивает параллельный граф задач, изолированные worktree и сабагенты в линейное редактирование файлов в текущей рабочей директории (`implement-spec/SKILL.md:19-39`).
6. **`triage` ➔ Взятие в работу сырых тикетов**: Модель берет задачи без статуса `ready-for-agent` или начинает работу над тикетом без оформления Agent Brief (`triage/SKILL.md:64`, `triage/AGENT-BRIEF.md:3`).
7. **`triage` ➔ Пропуск верификации**: Модель переходит к обсуждению или закрытию бага, не попытавшись его воспроизвести, или PR — не запустив тесты (`triage/SKILL.md:60`).
8. **`wayfinder` ➔ Срыв в реализацию**: Вместо фиксации решений модель начинает писать код по тикету («produce decisions, not deliverables», `wayfinder/SKILL.md:12`) либо пытается закрыть несколько тикетов за один запуск (`wayfinder/SKILL.md:79`).
9. **`code-review` ➔ Слияние осей**: Модель выполняет ревью в основном окне вместо двух параллельных изолированных сабагентов и перемешивает замечания Standards и Spec в общий список (`code-review/SKILL.md:12, 76`).
10. **`improve-codebase-architecture` ➔ Преждевременные интерфейсы**: Модель вываливает предложения интерфейсов прямо в первичном отчете, нарушая запрет: *"Do NOT propose interfaces yet"* (`improve-codebase-architecture/SKILL.md:57`).
11. **`domain-modeling` ➔ Засорение глоссария кодом**: Модель вставляет в `GLOSSARY.md` пути к файлам, названия классов и схемы баз данных вопреки запрету (`domain-modeling/SKILL.md:45`).
12. **`retro` ➔ Попытка менять код вместо окружения**: Модель предлагает исправления в кодовой базе вместо автоматических чеков, линтеров и правил ревьюера (`retro/SKILL.md:5-24`).

---

## 5. Артефакты флоу

| Артефакт | Путь размещения | Шаблон и обязательные разделы |
| :--- | :--- | :--- |
| **Domain Docs** | `docs/agents/domain.md`, `issue-tracker.md`, `triage-labels.md` | Создаются через `setup-matt-pocock-skills`. Разделы: Before exploring, File structure, Vocabulary, Flag ADR conflicts. |
| **Глоссарий** | `GLOSSARY.md` (корень) или `GLOSSARY-MAP.md` (мультиконтекст) | `# {Context}`<br>`## Language`<br>`**Term**:` Определение (1-2 предл.). `_Avoid_:` синонимы (`domain-modeling/GLOSSARY-FORMAT.md:5-21`). |
| **ADR** | `docs/adr/NNNN-<slug>.md` | `# {Title}`<br>1-3 предложения: контекст, решение, почему. Опционально: `Status`, `Considered Options`, `Consequences` (`domain-modeling/ADR-FORMAT.md:10-23`). |
| **Спецификация** | `.scratch/<feature>/spec.md` либо issue | `## Problem Statement`, `## Solution`, `## User Stories` (нумерованный список «As an... I want... so that...»), `## Implementation Decisions`, `## Testing Decisions`, `## Out of Scope`, `## Further Notes` (`to-spec/SKILL.md:21-65`). |
| **Тикет задачи** | `.scratch/<feature>/issues/<NN>-<slug>.md` либо issue | `# <NN>: <Title>`<br>`**What to build:**`<br>`**Blocked by:**`<br>`**Status:** ready-for-agent`<br>Чекбоксы критериев `- [ ]` (`to-tickets/SKILL.md:61-73`). |
| **Agent Brief** | Комментарий к issue / PR | `## Agent Brief`<br>`**Category:** bug / enhancement`<br>`**Summary:**`<br>`**Current behavior:**`<br>`**Desired behavior:**`<br>`**Key interfaces:**`<br>`**Acceptance criteria:**` (`- [ ]`)<br>`**Out of scope:**` (`triage/AGENT-BRIEF.md:36-60`). |
| **Out-of-Scope KB** | `.out-of-scope/<concept>.md` | `# <Concept Name>`<br>`## Why this is out of scope`<br>`## Prior requests` (список `#NN: ...`) (`triage/OUT-OF-SCOPE.md:18-42`). |
| **Прототип** | Ветка `prototype/<name>` | Логика: одиночный HTML с кнопками действий и выводом состояния (`prototype/LOGIC.md`). UI: роут с `?variant=` и плашкой (`prototype/UI.md`). |
| **Отчет архитектуры** | `<tmpdir>/architecture-review-<timestamp>.html` | HTML5 + Tailwind CDN + Mermaid CDN. Секции: `<header>`, `<section id="candidates">`, `<section id="top-recommendation">`. Карточки: Files, Problem, Solution, Benefits, Before/After, Badge (`improve-codebase-architecture/HTML-REPORT.md:9-40`). |
| **Handoff документ** | `<tmpdir>/handoff-*.md` | Сводка сессии, секция `suggested skills`, контекстные указатели на файлы/URL, ретушированные секреты `<REDACTED>` (`handoff/SKILL.md:6-14`). |
| **Опросник** | `to-questionnaire-<slug>.md` | `# <Title>`<br>`**Purpose:**`, `**From:**`, `**To:**`, `**How your answers will be used:**`<br>`## Context`, `## How to answer`, `## <Theme>`, `## Anything else?` (`to-questionnaire/SKILL.md:23-48`). |
| **Тело PR** | Описание pull request (`gh pr`) | `## Summary` (псевдокод/дерево/diff/mermaid)<br>`## Evidence` (Before / After)<br>`## Merge Danger` (`**Door:** one-way/two-way`, `**Blast Radius:**`) (`pr/SKILL.md:16-30`). |
| **Карта Wayfinder** | Issue с меткой `wayfinder:map` | `## Destination`, `## Notes`, `## Decisions so far` (список закрытых тикетов с ссылками), `## Not yet specified` (туман), `## Out of scope` (`wayfinder/SKILL.md:28-42`). |
| **Тикет Wayfinder** | Дочерний issue `wayfinder:<type>` | `## Question` (разрешаемый вопрос на сессию 100K токенов). Метка: `research`, `prototype`, `grilling` или `task` (`wayfinder/SKILL.md:40-44`). |
| **Учебный воркспейс** | Рабочий каталог `teach` | `MISSION.md` (цель, успех, ограничения, out of scope), `RESOURCES.md`, `./learning-records/0001-*.md`, `./lessons/0001-*.html`, `./reference/*.html`, `./assets/*`, `NOTES.md` (`teach/SKILL.md:12-25`). |
| **Workflow** | `workflows/*.md` (от `loop-me`) | Спецификация повторяющегося процесса: Trigger (event/schedule), Checkpoint (HITL), Push right, Brief (`loop-me/SKILL.md:16-26`). |
| **Wizard скрипт** | `scripts/*.sh` (от `wizard`) | Bash-скрипт на базе `template.sh` с функциями `stage`, `say`, `step`, `open_url`, `ask_secret`, `write_env`, `set_secret`, `confirm` (`wizard/SKILL.md:10-38`). |

---

## 6. Субагенты и их контракты

Флоу Matt Pocock активно делегирует изолированные фазы субагентам:

| Вызывающий скилл | Субагент | Запуск и среда | Входные данные | Контракт / Формат ответа |
| :--- | :--- | :--- | :--- | :--- |
| **code-review** | **Standards sub-agent** | Параллельно в foreground | Diff команды, список коммитов, файлы стандартов (`CODING_STANDARDS.md`), полный smell baseline (12 запахов Фаулера). | Отчет `<400` слов: нарушения стандартов со ссылкой на файл и правило; замеченные baseline smells с цитатой хунка (`code-review/SKILL.md:62-67`). |
| **code-review** | **Spec sub-agent** | Параллельно в foreground | Diff команды, список коммитов, путь или содержимое спеки/issue. | Отчет `<400` слов: (a) отсутствующие требования, (b) скоуп крип, (c) ошибочные реализации. Цитата строки спеки на каждый пункт (`code-review/SKILL.md:68-72`). |
| **implement-spec** | **Exploration subagent** | Фоновый агент (background) | Контекстные указатели на спеку, тикеты, кодовую базу. | Запись заметок в Markdown-файл **вне репозитория**, доступный последующим агентам (`implement-spec/SKILL.md:21`). |
| **implement-spec** | **Implementer subagents** | Фоновые агенты (по одному на тикет фронтира в отдельном git worktree) | Ветка тикета, базирующаяся на `integration`, указатель на тикет. | Вызывает скилл `tdd`. Перед завершением подтягивает tip ветки `integration` (`implement-spec/SKILL.md:25-29`). |
| **implement-spec** | **Merger subagent** | Последовательно после каждого implementer | Ветка завершенного тикета, ветка `integration`. | Слияние ветки тикета в `integration branch`, сигнал на пересчет фронтира задач (`implement-spec/SKILL.md:31-33`). |
| **grilling** | **Fact-finding subagent** | По мере обнаружения белых пятен | Запрос на проверку файловой системы, конфигураций или CLI. | Возврат найденного факта в контекст grilling, не блокируя независимые вопросы фронтира (`grilling/SKILL.md:27`). |
| **research** | **Research subagent** | Фоновый агент (background) | Исследуемый вопрос, ограничение: только первичные источники. | Одиночный Markdown-файл в репозитории с обязательным цитированием первоисточников. Без создания PR (`research/SKILL.md:6-14`). |
| **improve-codebase-architecture** | **Codebase walker** | Автономный агент | `GLOSSARY.md`, ADRs, горячие точки из `git log`. | Список мест трения, мелких модулей (shallowness), утечек абстракций и отсутствия локальности (`improve-codebase-architecture/SKILL.md:25-35`). |
| **codebase-design** | **Design-it-twice subagents** | 3+ параллельных субагента | Технический бриф с разными ограничениями (минимальный интерфейс / максимальная гибкость / дефолтный сценарий / ports & adapters). | 1. Интерфейс; 2. Пример использования; 3. Что скрыто за швом; 4. Адаптеры; 5. Трейд-оффы (`codebase-design/DESIGN-IT-TWICE.md:15-32`). |
| **claude-handoff** | **Handoff background agent** | CLI: `claude --bg --name "<name>" -- "$(cat <file>)"` | Файл handoff из temp директории. | Автономное продолжение работы в свежем контексте (`claude-handoff/SKILL.md:7-17`). |
| **chief-of-staff** | **Task subagents** | Все задачи выносятся в сабагентов | Минимальные контекстные указатели (context pointers). | Защита основного контекстного окна оркестратора (`chief-of-staff/SKILL.md:14-19`). |
| **impl-validator** | **Quality Validator** | Программный вызов блока `impl-validator check:` | `goal: "..."`, `artifacts: [...]`, `checks: [...]`. | Таблица проверок с результатами `PASS`/`WARN`/`FAIL`, итоговый вердикт `PASS` / `WARN` / `FAIL`, список дефектов (`impl-validator/SKILL.md:18-76`). |

---

## 7. Метки triage и переходы

Каноническая система меток задается `setup-matt-pocock-skills/triage-labels.md` и управляется конечным автоматом `triage/SKILL.md`.

### Роли и категории

1. **Категории (Category Roles)** — ровно одна на issue/PR (`triage/SKILL.md:23-26`):
   - `bug` — что-то сломано.
   - `enhancement` — новая функциональность или улучшение.

2. **Состояния (State Roles)** — ровно одно на issue/PR (`triage/SKILL.md:28-36`, `setup-matt-pocock-skills/triage-labels.md:7-11`):
   - `needs-triage` — maintainer needs to evaluate this issue (исходное состояние нетриажированных задач).
   - `needs-info` — waiting on reporter for more information (ожидание уточнений от автора).
   - `ready-for-agent` — fully specified, ready for an AFK agent (полностью специфицировано, есть Agent Brief).
   - `ready-for-human` — requires human implementation (требует участия человека: дизайн, внешние доступы, суждения).
   - `wontfix` — will not be actioned (закрыто без исполнения).

Для Pull Request (когда PRs включены как request surface в конфиге трекера):
- PR трактуется как issue с прикрепленным кодом (`triage/SKILL.md:12`).
- `ready-for-agent` на PR означает: бриф прикреплен, агенту поручено доработать/дочистить diff (`triage/SKILL.md:34`).
- `ready-for-human` на PR означает: diff готов к мержу человеком (`triage/SKILL.md:35`).

### Конечный автомат переходов

```text
       [Новый issue / PR]
               │
               ▼
        [needs-triage] ◄────────────────────────────────┐
         │     │     │                                  │
         │     │     └────────► [needs-info] ───────────┘
         │     │             (комментарий Triage Notes;
         │     │              возврат при ответе автора)
         │     │
         │     ├──────────────► [ready-for-human]
         │     │             (бриф с обоснованием участия человека)
         │     │
         │     ├──────────────► [ready-for-agent] ────► /implement или /implement-spec
         │     │             (комментарий Agent Brief)
         │     │
         │     └──────────────► [wontfix] (закрытие)
         │                       ├── Уже реализовано: ссылка на код (в .out-of-scope НЕ пишется)
         │                       ├── Отклоненный баг: вежливое объяснение
         │                       └── Отклоненный enhancement: запись в .out-of-scope/<concept>.md
         │
         └────────────────────► Ручной оверрайд мейнтейнера (любое состояние)
```

### Жизненный цикл базы знаний `.out-of-scope/`

- Запись создается **исключительно** при отклонении `enhancement` со статусом `wontfix` (`triage/OUT-OF-SCOPE.md:54`).
- Запрещено писать в `.out-of-scope/`, если задача закрыта как `wontfix` по причине «уже реализовано» (`triage/OUT-OF-SCOPE.md:56`).
- Один файл на один концепт: `.out-of-scope/<concept>.md`. При повторных запросах новый issue добавляется в секцию `## Prior requests` существующего файла (`triage/OUT-OF-SCOPE.md:16, 61`).
- При пересмотре решения мейнтейнером файл `.out-of-scope/<concept>.md` удаляется, а issue идет на обычный триаж (`triage/OUT-OF-SCOPE.md:70-75`).

### Метки Wayfinder

Скилл `wayfinder` оперирует изолированным пространством меток и **никогда** не использует метки триажа (`wayfinder/SKILL.md:44`):
- `wayfinder:map` — единственный корневой issue-карта.
- `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task` — дочерние тикеты решений.
- Статусы жизненного цикла тикета в трекере: `open` (не взят), `claimed` (назначен на разработчика перед стартом, `wayfinder/SKILL.md:46`), `resolved` (закрыт с добавлением комментария резолюции и ссылки в карту).
