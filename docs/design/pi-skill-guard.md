# pi-skill-guard: расширение, удерживающее модель внутри флоу mattpocock

Статус: **устарело.** Заменено на [pi-matt-x.md](pi-matt-x.md). Ничего не реализовано.
Основания: скиллы в `~/.pi/agent/skills/` и `~/.agents/skills/`, API расширений Pi 1.4.0
(`docs/extensions.md`, `docs/skills.md`), паттерны `pi-goal-x@0.34.1`.

---

## 1. Что такое «флоу mattpocock» по факту

Это **не конвейер с командами**, а граф скиллов, где:

- вход — это загрузка `SKILL.md` конкретного скилла, в Pi это `/skill:<name>`
  (`docs/skills.md:58-70`);
- большинство инженерных скиллов помечены `disable-model-invocation: true`
  (`grill-me`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `triage`, `ask-matt`,
  `handoff`, `loop-me`, `setup-matt-pocock-skills`), то есть запускает их **пользователь**,
  а не догадка модели (`docs/skills.md:64`);
- переходы между скиллами заданы текстом внутри скиллов: `grill-me/SKILL.md:6` — «Call the
  Skill tool with "grilling"», `grill-with-docs/SKILL.md:6` — «Call the Skill tool twice, for
  "grilling" and "domain-modeling"», `implement/SKILL.md:12` — «call the Skill tool with
  "code-review"», `triage/SKILL.md` шаг 4 — «call the Skill tool twice, for "grilling" and
  "domain-modeling"».

Граф:

```
/skill:triage ──► [FSM меток] ──► grilling + domain-modeling ──► ready-for-agent + agent brief
/skill:grill-me ─────► grilling ─────────────────┐
/skill:grill-with-docs ► grilling + domain-modeling ─┤
                                                      ▼  (граница фазы)
/skill:to-spec ──► спека в трекере (ready-for-agent) ──► /skill:to-tickets ──► тикеты с рёбрами
                                                      ▼
/skill:implement | /skill:implement-spec ──► tdd ──► /skill:code-review ──► commit / PR
```

`ask-matt` — роутер по этому графу, `PHASE-BOUNDARIES.md` — правила перехода между фазами,
`wayfinder`/`loop-me`/`research`/`prototype`/`diagnosing-bugs` — боковые входы.

**Ключевое наблюдение: гейты в скиллах уже написаны — прозой.** Расширению не нужно
придумывать процесс, нужно превратить конкретные предложения в проверки:

| Предложение в скилле | Что оно требует | Чем держится сейчас |
|---|---|---|
| `grilling/SKILL.md:30` «The session is done when the frontier is empty… Do not act on it until the user confirms you have reached a shared understanding» | запрет на любые действия до подтверждения | ничем |
| `grilling/SKILL.md:8` работа по **раундам** (раунд = один пакет вопросов) | стоп после каждого раунда | ничем |
| `to-spec/SKILL.md:17` «Check with the user that these seams match their expectations» | подтверждение швов до написания спеки | ничем |
| `to-spec/SKILL.md:23+` шаблон из 7 разделов | спека не публикуется без разделов | ничем |
| `to-tickets/SKILL.md:42` «### 4. Quiz the user» | разбиение показывается пользователю | ничем |
| `to-tickets/SKILL.md:56` «Iterate until the user approves the breakdown» | согласование разбиения | ничем |
| `to-tickets/SKILL.md:67` «Do NOT close or modify any parent issue» | запрет трогать родителя | ничем |
| `to-tickets/SKILL.md:77` `**Status:** ready-for-agent` | тикет без статуса — не тикет | ничем |
| `triage/SKILL.md:16` обязательный дисклеймер AI в каждом комментарии | комментарий без дисклеймера не публикуется | ничем |
| `triage/SKILL.md:41` «exactly one category role and one state role» | инвариант меток | ничем |
| `triage/SKILL.md:72` «Recommend» + шаг «Wait for direction» | стоп после рекомендации | ничем |
| `implement/SKILL.md:11,15,17` tdd → typecheck → suite → code-review → commit | 5 обязательных шагов | ничем |
| `implement-spec/SKILL.md:19-39` интеграционная ветка, worktree на тикет, merge, review, PR, cleanup | 9 шагов | ничем |
| `diagnosing-bugs/SKILL.md:52,58-61` «Do not proceed to hypothesise without a loop… No red-capable command, no Phase 2» | запрет читать код и строить теории до красной команды | ничем |
| `tdd/SKILL.md:22` «Test only at pre-agreed seams… confirm them with the user» | швы согласуются до теста | ничем |
| `tdd/SKILL.md:36,38` «Red before green… Refactoring is not part of the loop» | тест раньше кода, рефакторинг вне цикла | ничем |
| `code-review/SKILL.md:23` `git rev-parse <fixed-point>` + непустой diff | ревью не начинается на битом ref | ничем |
| `code-review/SKILL.md:76` «Do not merge or rerank findings» | две оси не сливаются | ничем |
| `wayfinder/SKILL.md:12,79` «produce decisions, not deliverables», «never resolve more than one ticket per session» | один тикет за сессию, без реализации | ничем |
| `improve-codebase-architecture/SKILL.md:57` «Do NOT propose interfaces yet» | интерфейсы только после выбора кандидата | ничем |
| `impl-validator/SKILL.md:18-76` вход `impl-validator check: goal/artifacts/checks` → таблица PASS/WARN/FAIL | структурированный вердикт | ничем |
| `pr/SKILL.md:16-30` ровно 3 секции: `## Summary`, `## Evidence`, `## Merge Danger` | PR без секций не создаётся | ничем |
| `PHASE-BOUNDARIES.md:5-9` решение о границе фазы — только на границе, по дереву из 5 вариантов | осознанный выбор continue/clear/handoff/subagent/compact | ничем |

Две оси принуждения, обе выведены из этих же файлов:

- **внутри фазы** — не дать пропустить шаг скилла и его текстовые «wait / quiz / confirm»;
- **на границе фазы** — не дать уехать в следующий скилл/компакцию молча, без выбора из
  дерева `PHASE-BOUNDARIES.md`.

---

### 1.1 Самые «механические» гейты — начать с них

Три скилла дают проверку, которую видно из факта вызова инструмента, без всякого аудитора:

- **`diagnosing-bugs`**: до появления и запуска команды с ненулевым кодом возврата на
  воспроизведении бага — никаких `edit`/`write` и никакого чтения кода «для теории»
  (`diagnosing-bugs/SKILL.md:52, 58-61`). Гейт: `bash` вернул non-zero с признаком
  воспроизведения → открывается мутация.
- **`tdd`**: сначала тест, который падает (`tdd/SKILL.md:36`); швы согласованы
  (`tdd/SKILL.md:22`). Гейт: прогон теста с non-zero до первого `edit` исходника.
- **`wayfinder`**: ровно один тикет за сессию (`wayfinder/SKILL.md:79`), результаты — решения,
  а не код (`:12`). Гейт: второй `claim` в сессии блокируется.

Остальные гейты — про человеческое подтверждение или артефакт, и о них ниже.

### 1.2 `impl-validator` — готовый контракт аудитора (L4)

Скилл уже описывает машинный протокол: входной блок `impl-validator check:` с полями
`goal`, `artifacts`, `checks`, выход — таблица проверок и вердикт `PASS` / `WARN` / `FAIL`
(`~/.agents/skills/impl-validator/SKILL.md:18-76`). Это ровно тот интерфейс, который нужен
аудитору из §4: не надо изобретать формат, надо скормить ему рубрику фазы и распарсить вердикт.
Использовать как есть, но не через отдельный процесс, а через `ctx.modelRegistry.streamSimple()`.

### 1.3 Цитаты нельзя держать по номерам строк

Проверка показала: две копии набора (`~/.agents/skills/` и `~/.pi/agent/skills/`) для семи
ключевых скиллов **побайтово совпадают** (sha256 сверен), но нумерация в сторонних конспектах
уезжает на 2–10 строк. Вывод для контрактов: привязка — имя скилла + **текст заголовка или
регексп на императив**, а не `:NN`. Цитата в `reason` полезна модели, номер строки — нет.

## 2. Как расширение узнаёт, что фаза началась

Два наблюдаемых сигнала, оба — ground truth, без догадок:

1. **Загрузка скилла.** Модель читает `SKILL.md` — это вызов `read`, видимый в `tool_call`.
   Путь заканчивается на `skills/<name>/SKILL.md`. Срабатывает и для `/skill:<name>`
   (пользовательский вход, `docs/skills.md:58-64`), и для авто-выбора по `description`.
2. **Текст скилла во вводе.** `/skill:<name> args` подставляет инструкции скилла в
   пользовательский запрос (`docs/skills.md:62`), значит `input`-хук видит содержимое скилла
   и его аргументы.

Чего делать **не** нужно:

- не вводить свои команды вида `/flow start` — вход во флоу уже есть, это `/skill:<name>`;
- не переписывать `SKILL.md` — это источник инструкций, а не место для проверок;
- не пытаться угадать «намерение» по свободному тексту пользователя: скиллы с
  `disable-model-invocation` и так запускаются только явно.

---

## 3. Механизмы Pi, которыми это исполняется

Реальные хуки (`docs/extensions.md:94-125, 147-165`).

| Механизм | API | Роль |
|---|---|---|
| Блок вызова инструмента | `tool_call` → `{ block: true, reason }` | страховка и обучающий отказ |
| Урезание набора инструментов | `pi.setActiveTools()` | модель не видит запрещённое, а не «видит и не делает» |
| Постоянный блок правил в запросе | `context` (+ `context_with_system`) | правила фазы не выпадают из контекста |
| Подмена/обогащение ввода | `input` | распознать `/skill:<name>` и args |
| Переход только через проверку | собственный инструмент (напр. `finish_phase`) | модель не решает сама, что шаг сделан |
| Продолжение цикла | `agent_settled` → `{ continue: true }` | не оборвать фазу на середине |
| Независимая приёмка | `ctx.modelRegistry.streamSimple()` / субагент | там, где критерий — суждение |
| Устойчивость кэша | `before_provider_request` + сдвиг breakpoint | блок фазы не убивает кэш префикса |
| Изоляция сабагентов | `PI_SUBAGENT_CHILD` / `PI_SUBAGENT_DEPTH` | ребёнок не двигает фазу родителя |

`agent_end` — не сигнал покоя: там ещё ретраи, компакция, очередь. Единственная точка, где Pi
гарантирует отсутствие автоматической работы, — `agent_settled` (`docs/extensions.md:158-161`).
goal-x этому следует: продолжение взводится в `agent_end` (`extensions/goal-events.ts:558`),
планируется в `agent_settled` (`extensions/goal-events.ts:614`).

---

## 4. Пять слоёв принуждения

### L1 — правила фазы в каждом запросе (бесплатно)

`context`-хук добавляет request-only блок, не попадающий в историю:

```
[SKILL PHASE grill round=2/∞ id=…]
Скилл: ~/.pi/agent/skills/grilling/SKILL.md
Разрешено: read grep find ls bash ask_user_question finish_phase
Заблокировано кодом: write edit
Критерий выхода:
  ⬜ фронтьер пуст (открыт 1 вопрос)
  ⬜ пользователь подтвердил общее понимание
```

Две части, как в goal-x: **стабильная** (фаза, правила, чеклист) и **волатильная** (счётчики,
раунд). Разделение держит префикс кэша — `goal-context.ts` + `LiveTailRetention` в
`goal-live-retention.ts`, плюс сдвиг breakpoint назад в `goal-prompt-cache.ts:1-68`.

### L2 — у инструментов нет варианта «просто сделать»

1. `pi.setActiveTools([...])` при входе в фазу: в `grill` модель не видит `write`/`edit`.
2. `tool_call` возвращает `{ block: true, reason }` для всего вне allowlist — страховка от
   MCP, codemode и вложенных `ctx.executeTool` (`docs/extensions.md:261`).

`reason` — инструкция, а не стена: «write заблокирован: фаза grill не закрыта (открыт 1 вопрос).
Задай следующий раунд или вызови finish_phase». Так же сделано в
`goal-events.ts:133-186`. Fail-closed по умолчанию (`docs/extensions.md:375`).

### L3 — выход из фазы только через критерий

Модель не «решает», что шаг сделан. Единственный путь — инструмент `finish_phase`, который
сверяет критерии фазы и при невыполнении возвращает `isError: true` со списком недостающего.
При выполнении: событие в ledger, смена фазы, пересборка active tools, инжект нового блока.

### L4 — аудитор там, где критерий — суждение

«Спека полная», «ревью действительно сделано», «вопросы были по делу» файлом не проверяются.
Для них — read-only прогон отдельной моделью: на вход артефакт и рубрика, на выход
`pass | warn | fail` + причины, вердикт в ledger и в L1-блок как `[AUDITOR REJECTION]`.
Аналог: `goal-auditor.ts`, `auditor-selector.ts`, `goal-oracle.ts`.

### L5 — фаза не обрывается сама

Есть незакрытая обязательная работа (шаги `implement-spec`, красные тесты) — расширение в
`agent_settled` возвращает `continue: true`. Есть человеческий гейт (раунд гриля, подтверждение
швов, quiz по тикетам) — продолжение не запрашивается, а мутирующие инструменты заблокированы:
проскочить нечем и некому подгонять.

---

## 5. Контракты фаз — декларативно, из самих скиллов

Фазы живут в `.pi/skills-guard/contracts/<skill>.yaml`, движок их читает. Хардкод в TS означает
правку кода при каждой правке скилла.

```yaml
skill: grilling
enter: auto                      # ловится по загрузке SKILL.md
allow: [read, grep, find, ls, bash, ask_user_question, finish_phase]
deny:  [write, edit]
gates:
  - id: round
    kind: user_answer            # стоп после каждого раунда (grilling/SKILL.md:11)
  - id: shared-understanding
    kind: user_confirm           # grilling/SKILL.md:30
    prompt: "Фронтьер пуст — понимание общее, можно переходить к спеке?"
on_exit: phase-boundary          # дерево PHASE-BOUNDARIES.md, а не автоматический переход
```

```yaml
skill: diagnosing-bugs
allow: [read, grep, find, ls, bash, finish_phase]   # edit/write — только после red loop
gates:
  - id: red-loop
    kind: command                 # diagnosing-bugs/SKILL.md:52, 58-61
    check: last_bash_exit_code != 0 and command_reproduces_bug
    block_until: true             # без него — никаких edit/write вообще
    reason: "Нет красной команды — нет Phase 2. Сначала воспроизведи."
  - id: reproduced
    kind: user_confirm            # diagnosing-bugs/SKILL.md:73
  - id: regression-test
    kind: git                     # тест на шве до фикса, diagnosing-bugs/SKILL.md:103
    check: test_added_and_ran_red_before_fix
on_exit: phase-boundary
```

```yaml
skill: to-spec
allow: [read, grep, find, ls, bash, finish_phase]   # write — только после гейта швов
deny:  [write, edit]
gates:
  - id: seams
    kind: user_confirm           # to-spec/SKILL.md:17-19
  - id: template
    kind: artifact               # to-spec/SKILL.md:24+
    require_sections: ["## Problem Statement", "## Solution", "## User Stories",
                       "## Implementation Decisions", "## Testing Decisions",
                       "## Out of Scope", "## Further Notes"]
  - id: published
    kind: command                # ярлык ready-for-agent на опубликованной спеке
    check: tracker_has_label(ready-for-agent)
```

Типы критериев, которых достаточно: `user_confirm`, `user_answer`, `artifact` (файл + разделы),
`command` (трекер/GitHub/`gh`), `git` (ветка, коммиты, чистое дерево), `auditor`.
Всё остальное — производное.

---

## 6. Состояние

```
.pi/skills-guard/
  active.json                 # текущая фаза в сессии
  <phaseId>/
    phase.json                # { id, skill, startedAt, gates: {...}, revision }
    phase.lock
    events.jsonl              # phase_entered, gate_blocked, gate_passed,
                              #   artifact_checked, auditor_verdict, boundary_choice, override
```

Переиспользовать, а не изобретать: `storage/atomic-rename.ts`, `storage/goal-lock.ts`,
`storage/goal-root.ts` из goal-x (тот же класс задачи — один файл, много процессов), и правило
«мутации копятся за ход и сбрасываются одной транзакцией под локом с проверкой `revision`»
(`goal-service.ts:180-215`).

---

## 7. Что копируем из goal-x поимённо

| Паттерн | Откуда | Зачем |
|---|---|---|
| Тонкий установщик + ядро | `extensions/goal.ts:1-30` | одна точка входа, подсистемы по файлам |
| Единственный рубеж мутаций | `goal-service.ts` | одно место записи, тестируемо |
| Request-only блок состояния | `goal-context.ts`, `goal-events.ts:456-556` | правила в запросе, не в истории |
| Стабильный/волатильный блок | `goal-live-retention.ts` | префикс кэша не инвалидируется |
| Сдвиг cache breakpoint | `goal-prompt-cache.ts:1-68` | Anthropic/Bedrock не теряют кэш |
| Гейт в `tool_call` с обучающим reason | `goal-events.ts:133-186` | блок вместо стены |
| Продолжение только из `agent_settled` | `goal-events.ts:558, 614` | не ломается о ретраи/компакцию |
| Вердикт аудитора в промпте | `goal-auditor.ts`, `goal-ledger.ts` | отказ не забывается после сжатия |
| `isDelegatedGoalSession` | `goal-session-safety.ts:10-12` | сабагент не двигает фазу |
| Fail-closed | `goal-events.ts:133` | безопасный дефолт |

Честный объём: **12–15 файлов** (контракты+парсер, состояние, сервис-мутации, storage ×3,
L1-блок, L2-гейт, L3-переход, ledger, аудитор, продолжение, команды/UI, точка входа).

---

## 8. Что не делать

- Не дублировать текст скиллов в расширении — только оболочка: фаза, allowlist, критерий.
- Не заменять системный промпт (`forceSystemPrompt`) — обнуляет кэш префикса каждый ход
  (`docs/extensions.md:228`).
- Не подменять формат вопросов: `ask_user_question` и формат раундов гриля — дело скилла.
  Движок проверяет только «гейт открыт/закрыт».
- Не делать блокировку неотключаемой: `override` с обязательной причиной и записью в ledger.
  Дрейф должен быть виден, а не невозможен — иначе первая ложная блокировка убьёт расширение.

---

## 9. Открытые вопросы

1. **Какие скиллы получают контракт.** Ядро цепочки (grill-me, grill-with-docs, grilling,
   to-spec, to-tickets, implement, implement-spec, tdd, code-review, pr) — обязательно.
   Второй круг с чистыми механическими гейтами: diagnosing-bugs, wayfinder, triage.
   Третий круг (research, prototype, retro, improve-codebase-architecture, teach,
   to-questionnaire) — только `allowlist` и проверка артефакта, без человеческих гейтов.
   Рекомендация: в первой версии — первые два круга, третий — потом.
2. **Граница фазы.** Заставлять проходить дерево `PHASE-BOUNDARIES.md` явно (диалог с выбором
   из 5 вариантов) или только логировать фактический переход и предупреждать при компакции
   посреди фазы (`PHASE-BOUNDARIES.md:11-14`)?
   Рекомендация: явный выбор только при уходе из фазы в другую фазу; компакцию — предупреждать.
3. **Кто инициирует `to-spec`.** Он помечен «no interview, just synthesis»
   (`to-spec/SKILL.md:2-3`) и запускается только пользователем. Значит ли это, что после
   подтверждения фронтьера расширение должно **остановиться и попросить** пользователя вызвать
   `/skill:to-spec`, вместо того чтобы идти дальше само?
   Рекомендация: да, остановиться — это и есть «не проскочить на границе».
4. **Автопродолжение внутри фазы.** Уже решено: да внутри, стоп на гейтах. Осталось уточнить,
   считается ли `tdd` отдельной фазой с гейтом («red» до «green») или подшагом `implement`.

---

## 10. Риски

- **Ложные блокировки.** Во время допроса иногда нужно поправить файл, чтобы показать вариант.
  Лечится `override`, но он должен быть дешёвым.
- **Стоимость L4.** Отдельный прогон модели на переход; включать точечно (spec, review).
- **Кэш промпта.** Любая нестабильность L1-блока = инвалидация префикса каждый ход.
  Надёжный образец — только goal-x, и его `LiveTailRetention` неочевиден.
- **Несколько сессий/веток.** Без лока и `revision` состояние затирается.
- **Неинтерактивные режимы.** В `json`/`print` нет `ctx.ui`; человеческий гейт должен
  деградировать в «остановиться и ждать ввода», а не зависнуть.

---

## 11. Статус реализации (v1)

Собрано и проверено (`tsc` по реальным типам Pi 1.4.0 + 14 тестов на `node --test`):

| Файл | Что делает |
| --- | --- |
| `extensions/skill-guard/contracts.ts` | 11 контрактов с цитатами из самих скиллов |
| `extensions/skill-guard/engine.ts` | чистое решение: `decide(state, request, contracts)` |
| `extensions/skill-guard/index.ts` | адаптер Pi: `tool_call` + `read` SKILL.md + гейт через `ctx.ui.editor` |
| `.pi/extensions/skill-guard.ts` | загрузчик: одна строка, реэкспорт |
| `extensions/skill-guard/contracts.test.ts` | цитаты сверяются с установленными `SKILL.md` |
| `extensions/skill-guard/index.test.ts` | адаптер: события, форма блокировки, гейт-ровно-один-раз |

Из пяти слоёв §4 работают два:

- **L2 (возможности)** — `tool_call` блокируется, если инструмента нет в списке фазы.
- **L3 (граница фазы)** — читать можно только `SKILL.md` наследника; на границе
  задаётся вопрос-гейт, отмена вопроса блокирует переход.

Не сделано намеренно: **L1** (вставка правил фазы в каждый запрос), **L4** (`impl-validator`
как аудитор), **L5** (запрет обрывать фазу), а также требование «сначала красная команда»
для `diagnosing-bugs` — в контракте нет поля для наблюдаемого условия.

Два факта из первичных источников, которые отменяют часть дизайна:

- Pi сам скрывает от модели скиллы с `disable-model-invocation: true`
  (`formatSkillsForPrompt` их отфильтровывает), поэтому 23 из 33 скиллов модель не может
  открыть в принципе — порядок между ними держит пользователь, а не расширение.
- `newSession()` есть только у `ExtensionCommandContext`, не у `ExtensionContext`,
  который получает обработчик `tool_call`. Значит автоматический переход в новую сессию
  из гейта невозможен без собственной команды — и не нужен (ADR-0004).
