# skill-guard: узкие места

Аудит того же класса, что два уже исправленных дефекта: комментарий расходится с
кодом, контракт шире замысла, охрана обходится. Каждая находка сверена с кодом и с
установленными `SKILL.md` в `C:\Users\ralex\.agents\skills`.

Строки указаны по состоянию `b2a2cc4` — коммиту, на котором велся аудит. Правки — в
следующем коммите; там же поменялись номера строк.

## Сводка

| # | Где (b2a2cc4) | Что не так | Важность | Статус |
|---|---|---|---|---|
| D1 | `engine.ts:22` | Список «только чтение» неполон, а `lean_ctx`/`ctx_call` (запускают CLI и любые инструменты) в нём отсутствовали не будучи в exec | средняя | исправлено |
| D2 | `engine.ts:55` | `filter((s) => … \|\| s)` — всегда истинно; сама `nextPhases` не вызывалась нигде, кроме теста | низкая | исправлено |
| D3 | `index.ts:46` | `/skill:<любое имя>` ставило фазу: опечатка и `domain-modeling` молча снимали охрану | средняя | исправлено |
| D4 | `tsconfig.json:21` | Тесты исключены из `tsc` — «tsc чисто» их не покрывало | низкая | исправлено |
| D5 | `engine.ts:30` | `ctx_edit` считался `write`, а `edit` — отдельной возможностью, которую никто не мог использовать | низкая | исправлено |
| D9 | `engine.ts:27` | Комментарий: «Unknown tools … are always allowed» — в открытой фазе они уходят в диалог или блок | средняя | исправлено |
| D10 | `index.ts:9` | Комментарий: «any unknown skill works as before» — опровергается кодом и тестом `reading an uncontracted skill does not lift the phase` | средняя | исправлено |
| D6 | `contracts.ts:44,56,69` | Три цитаты гейтов — не условия конца фазы | средняя | исправлено |
| D7 | `index.ts` весь | Из фазы нельзя выйти: сессия остаётся ограниченной до перезапуска | средняя | спорное |
| D8 | `index.ts:79` | Ответ пользователя на гейт нигде не хранится | низкая | исправлено |
| D11 | `contracts.ts:4` | Шапка: «A skill with no contract is unguarded: every tool is allowed» — опровергается кодом | средняя | исправлено |
| D12 | `contracts.ts:54` | Комментарий: `grill-me` берёт процесс «из описания роутера», а `source` указывает на `grilling` | средняя | исправлено |
| D13 | `engine.ts:45` | Комментарий `skillNameFromPath`: «матчит и `<name>` из `/<name>`» — регексп требует `SKILL.md` | средняя | исправлено |
| D14 | `contracts.ts:110` | «Read-only on purpose» при `grants: ["read","bash"]` — `bash` пишет; 7 контрактов дают `bash`, поэтому `read`/`write` не обеспечены | высокая | комментарий исправлен, сужение прав открыто |
| D15 | `index.ts:96` | `gatesPassed` не очищался при возврате в фазу: второй уход из неё проходил без гейта | высокая | исправлено |

---

## D1. Список read-only инструментов не покрывал установленное окружение

`engine.ts:22`

```ts
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "ctx_read", "ctx_grep", "ctx_find", "ctx_ls"]);
```

`grantFor` возвращает `null` для всего, чего нет в списке. Дальше `needsPermission`
решает: инструмент неизвестен, а фаза не даёт `bash` — спросить пользователя.

Последствие: в фазе `grilling` (только `read`) вызов `ctx_search`, `symbol_search`,
`module_report`, `wiki_search` открывал диалог «Разрешить?». Модель уходила от этих
инструментов к `grep`, которого не хватает, или тревожила пользователя на каждом шаге.

Отдельно: `lean_ctx` запускает CLI `lean-ctx`, а `ctx_call` вызывает любой инструмент по
имени. Ни тот, ни другой в списках не значились — они попадали в ветку «неизвестен» и в
фазе с `bash` проходили без единого вопроса.

Источник имён — не догадка: `pi-lean-ctx/extensions/index.ts` (там же `ctx_edit`,
`ctx_find`, `ctx_grep`, `ctx_ls`, `ctx_read`, `ctx_shell`, `lean_ctx`), `pi-lens/dist`
(`ast_grep_search`, `ast_grep_replace`, `ast_grep_outline`, `lsp_navigation`) и живой
список инструментов этой сессии для `ctx_*` из CLI.

## D2. Мёртвое условие в `nextPhases`

`engine.ts:55`

```ts
return c.successors.filter((s) => contractOf(contracts, s) !== undefined || s);
```

`|| s` — непустая строка, всегда истинна. Фильтр возвращал весь список: замысел был
отбросить наследников без контракта, код этого не делал.

Вторая половина: `nextPhases` не вызывалась в проде вообще — только в тесте. Убрана
целиком, проверка переехала на `CONTRACTS` напрямую.

## D3. `/skill:<имя>` ставило фазу без проверки

`index.ts:46`

```ts
const m = /^\/skill:([\w-]+)/.exec(event.text.trim());
if (!m?.[1]) return;
state.phase = m[1];
```

Имя не сверялось ни с `CONTRACTS`, ни с `SUB_SKILLS`.

Последствие: `/skill:implemet` писало в состояние фазу без контракта. `contractOf`
возвращал `undefined`, все инструменты разрешены, статус показывал `phase: implemet → —`.
Охрана выключена, но выглядит включённой.

Тот же обход с законным именем: `/skill:domain-modeling` во время `to-spec`. Скилл есть в
`SUB_SKILLS`, контракта не имеет — фаза ставилась, ограничения снимались молча.
Воспроизведение и проверка теперь в тесте `"/skill: of a skill without a contract does
not lift the open phase"`.

## D4. Тесты вне `tsc`

`tsconfig.json:21`: `"exclude": ["extensions/**/*.test.ts"]` с комментарием «их проверяет
запуск». Запуск `node --test` стирает типы, а не проверяет их. `index.test.ts` приводит
фейковый `pi` через `as unknown as ExtensionAPI` — ошибка в обвязке всплыла бы только в
рантайме.

Проверка: с тестами в `include` `tsc` проходит без ошибок, исключение убрано.

## D5. В контрактах жила возможность, которой не было у половины фаз

`engine.ts:30`: `if (tool === "write" || tool === "ctx_edit") return "write";` — а `edit`
отдавал `"edit"`, и семь контрактов на `b2a2cc4` давали `"edit"` прямо. То есть механизм
работал, но непоследовательно: `grill-with-docs` давал `["read", "write"]`, поэтому
`write` проходил, а собственный инструмент Pi `edit` — нет. Симметрично `"edit"` без
`"write"` не давал бы `ctx_edit`.

Исправлено: `Grant = "read" | "write" | "bash"`, `edit`, `write`, `ctx_edit`,
`ast_grep_replace` одинаково требуют `write`, и ни одна фаза больше не называет
возможность, которую невозможно выдать.

## D14. `bash` шире, чем обещают grant-листы

`contracts.ts:110`: «Read-only on purpose: review reports, it does not fix» — рядом
`grants: ["read", "bash"]`. `bash` — это целая оболочка (`sed -i`, `git commit`), движок
смотрит только `toolName`, поэтому `code-review` может писать. Семь из одиннадцати
контрактов дают `bash`, и для них список `read`/`write` не обеспечен: `grill-with-docs`
даёт `["read", "write"]` и всё равно может выполнить `git commit` через `bash`.

Комментарий исправлен (одна строка) — он теперь говорит, что фаза может писать через
`bash`. Сузить сами права — не правка в две строки: нужен разбор команд, а не grant
(в списке открытых, вместе с D7).

## D9. Комментарий обещал больше, чем код

`engine.ts:27`: «Unknown tools map to null and are always allowed». В открытой фазе
неизвестный инструмент идёт в `needsPermission` — диалог, а без UI блок. Комментарий
исправлен: `null` значит «без фазы разрешено, в фазе решает пользователь».

## D10. Заголовочный комментарий адаптера

`index.ts:9`: «Not guarded: model-invoked skills that have no contract (any unknown skill
works as before)». Код и тест `reading an uncontracted skill does not lift the phase`
говорят обратное: скилл без контракта читается, но ограничения открытой фазы не снимает.

## D11. Шапка контрактов повторяла ту же неправду

`contracts.ts:4`: «A skill with no contract is unguarded: every tool is allowed and it can be
entered from anywhere». Это спецификация контрактов — самое заметное место, и она
описывала поведение, которого нет: `decide` для скилла без контракта возвращает
`phase: state.phase`, то есть ограничения открытой фазы остаются.

---

## Детали находок (открыты D7 и D14)
### D6. Цитата гейта — не условие конца

Плохих цитат было три, а не две:

- `contracts.ts:44` — `grilling`: «Work the tree in **rounds**. The **frontier** is every decision
  whose prerequisites are already settled…» — описание процедуры.
- `contracts.ts:56` — `grill-me`: «the same relentless interview as `/grill-with-docs`, but
  **stateless**…» — описание скилла. В собственном `grill-me/SKILL.md` условия конца нет
  вовсе, только «Call the Skill tool with "grilling"».
- `contracts.ts:69` — `grill-with-docs`: «Skill tool twice, for "grilling" and
  "domain-modeling"» — инструкция.

Настоящее условие конца есть только у `grilling`, `SKILL.md:30`:

> The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed.

`grill-me` и `grill-with-docs` делегируют в него (`grill-me/SKILL.md:7`,
`grill-with-docs/SKILL.md:7`), поэтому все три гейта получили `source: "grilling"` и
эту цитату. Дословность проверяет `contracts.test.ts` («every gate quote is verbatim in
its skill»).

Последствие неисправленного дефекта: пользователь видит у гейта доказательство,
которое не отвечает на заданный вопрос, и отвечает «да» на глазок. Гейт держится
на цитате; если цитата не та, механизм не работает.

### D15. Подтверждение гейта переживало возврат в фазу

`index.ts`: `state.gatesPassed.push(state.phase)` при закрытии гейта, и никто его не чистил.
`grill-with-docs` и `prototype` — соседи по наследникам, а `prototype` гейта не имеет:
вход `grill-with-docs` → `prototype` спрашивает гейт, цикл обратно в `grill-with-docs`
вопроса не требует, и второй уход из неё — например в `to-spec` — проходил без гейта.
Один ответ покрывал два выхода из фазы.

Исправлено: при входе в фазу её прежнее подтверждение сбрасывается
(`state.gatesPassed = state.gatesPassed.filter((p) => p !== decision.phase)`), то есть
второй визит — это новые вопрос и ответ. Тест
`re-entering a phase spends its old answer, so leaving it again asks` требует `asked === 2`.

### D7. Из фазы нельзя выйти

`implement`, `code-review`, `diagnosing-bugs` перечисляют в наследниках `retro`, `pr`,
`handoff`. У этих трёх контрактов нет — они есть в `~/.agents/skills`, но не в
`CONTRACTS`.

Скилл без контракта не меняет фазу. Значит после входа в любую фазу сессия остаётся
ограниченной до конца: `/reload` или новая сессия — единственный выход.

Варианты: (а) контракты для `pr`/`handoff`/`retro` с пустыми `grants` и `successors` —
выход из флоу как фаза; (б) невидимая фаза «вне флоу», куда ведёт любой скилл без
контракта, если пользователь так сказал; (в) явная команда снятия охраны.

### D8. Ответ на гейт терялся

`index.ts:79`: ответ редактора уходил в `gatesPassed.push`, текст терялся.

В `GLOSSARY.md` «Обход» определён как «осознанный отказ от гейта с записанной причиной».
Записывался только факт, не причина.

Исправлено: ответ хранится в `lastClosure` вместе с фазой, которую он закрыл, и
показывается в статусной строке как `· закрыли grilling: да, идём` (реальный переход: гейт
`grilling` закрывается входом в `grill-me`). За текущий ответ себя выдать не может:
`lastClosure.phase` печатается рядом, а в саму закрытую фазу он не попадает — условие
`lastClosure.phase !== c?.name`. Это условие нужно: `grill-with-docs` и `prototype`
состоят в цикле наследников (`contracts.ts:68`, `contracts.ts:124`), и вернуться в уже
закрытую фазу можно без сброса и без нового вопроса, потому что `prototype` гейта не
имеет. Тест `the answer of a closed phase does not come back when a cycle re-enters it`
воспроизводит именно этот оборот.

Оговорка: ответ живёт до сброса (новая сессия или `/skill:`), а не только в следующей
фазе — но показывается всегда как чужая закрытая фаза.

### D12. Комментарий у гейта `grill-me` описывал прежний источник

`contracts.ts:54`: «grill-me inherits its own process from the router's description of it»,
а `source` рядом уже `"grilling"` — расхождение внесено правкой D6 и не было записано.

Исправлено: комментарий называет настоящий источник — `grill-me/SKILL.md:7` делегирует
интервью в `grilling`, поэтому и условие конца оттуда.

### D13. `skillNameFromPath` обещал то, чего не делает

`engine.ts:64`: «Also matches the `<name>` of a `/<name>` mention, which is how a skill is
loaded». Регексп `/(?:^|[\\/])([^\\/]+)[\\/]SKILL\.md$/i` требует хвоста `SKILL.md`:
`skillNameFromPath("/grilling")` и `skillNameFromPath("grilling")` возвращают `null`.
Упоминания `/skill:name` разбирает обработчик `input`, не эта функция.

Исправлено: комментарий говорит только о путях к `SKILL.md` и указывает, где живёт
`/skill:`.

---

## Что исправлено

| Находка | Правка |
|---|---|
| D1 | Список дополнен именами из установленных расширений; `lean_ctx`, `ctx_call` добавлены в exec. |
| D2 | `nextPhases` удалена вместе с мёртвым фильтром, тест смотрит в `CONTRACTS`. |
| D3 | Фазу ставит только имя из `CONTRACTS`; `/skill:domain-modeling` больше не снимает охрану. |
| D4 | Тесты в `include`, исключение убрано. |
| D5 | `Grant` стал `read \| write \| bash`; `edit`, `write`, `ctx_edit`, `ast_grep_replace` требуют `write`. |
| D9 | Комментарий `grantFor` описывает реальное поведение. |
| D10 | Заголовок адаптера описывает реальное поведение. |
| D11 | Шапка `contracts.ts` больше не обещает, что скилл без контракта снимает охрану. |
| D8 | Ответ на гейт хранится с фазой, которую закрыл, и не печатается внутри неё самой (цикл `grill-with-docs` ↔ `prototype`). |
| D6 | Три гейта ссылаются на настоящее условие конца `grilling`, `source` исправлен на `grilling`. |
| D12 | Комментарий у гейта `grill-me` называет настоящий источник — `grilling`. |
| D13 | Комментарий `skillNameFromPath` говорит только о путях к `SKILL.md`. |
| D14 | Комментарий `code-review` больше не обещает readonly при `bash`. |
| D15 | При входе в фазу её прежнее подтверждение гейта сбрасывается (`gatesPassed.filter`), тест — `re-entering a phase spends its old answer, so leaving it again asks`. |

Проверка: `npx tsc --noEmit` чисто (вместе с тестами), `npm test` 37/37.
