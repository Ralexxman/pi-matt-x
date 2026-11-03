/**
 * pi-skill-guard — keeps the model inside the Matt Pocock skill flow.
 *
 * The flow has no commands of its own: a phase is entered the normal way, by the
 * model reading a skill's SKILL.md. That read is the only transition point, so it is
 * the only place order is enforced; tool calls are the only place capability is.
 *
 * Not guarded: a skill with no contract is readable from any phase and stays readable,
 * but it does not lift or change the open phase either; and headless runs (json/print
 * modes have no dialog, so the gate degrades to a notification instead of deadlocking).
 *
 * shortcut: a skill without a contract is still not a phase, and headless runs have no
 * dialog to ask a gate in.
 *
 * The phase is saved to `.pi/skills-guard/sessions/<sessionId>.json` so `/reload` and a
 * resumed session keep it; `/matt` shows it and `/matt goto` moves it.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONTRACTS, SUB_SKILLS } from "./contracts.ts";
import { contractOf, decide, commandCloses, gateText, grantFor, needsGate, needsPermission, phaseBlock, skillNameFromPath, specCheck, trackerRead, type GuardState } from "./engine.ts";
import { findRoot, readState, statePath, writeState } from "./state.ts";

export default function (pi: ExtensionAPI): void {
	const state: GuardState = { phase: null, gatesPassed: [] };
	/** `${phase}:${tool}` the user already allowed, so one answer does not cost a dialog per call. */
	const allowed = new Set<string>();
	/** The last answer that closed a phase: history for the next one, never the current one's own. */
	let lastClosure: { phase: string; answer: string } | null = null;
	/** Where this session's phase is saved; null when the run has no cwd (headless, tests). */
	let sessionFile: string | null = null;
	/** Auto-continuations asked for in this user turn: the ceiling that keeps a loop from spinning. */
	let continues = 0;
	const MAX_CONTINUES = 3;
	/**
	 * A subagent is a separate process with its own session id: its phase is the parent's,
	 * read from the parent's file. It may use that phase's capabilities and may not move the
	 * phase or close a gate — two processes writing one file would fight over the same state.
	 */
	const inherited = process.env.PI_SUBAGENT_CHILD === "1" ? (process.env.PI_SUBAGENT_PARENT_SESSION ?? "") : "";

	const fileFor = (ctx: unknown): string | null => {
		const c = ctx as { cwd?: string; sessionManager?: { getSessionId?: () => string } };
		const id = c.sessionManager?.getSessionId?.();
		const root = c.cwd ? findRoot(c.cwd) : null;
		return id && root ? statePath(root, id) : null;
	};

	// A failed write costs the next reload's restoration, not the running session.
	let saveError: string | null = null;
	const persist = () => {
		if (!sessionFile) return;
		try {
			writeState(sessionFile, state);
			saveError = null;
		} catch (error) {
			saveError = error instanceof Error ? error.message : String(error);
		}
	};

	const showPhase = (ui: { setStatus: (key: string, text: string | undefined) => void }) => {
		const c = contractOf(CONTRACTS, state.phase);
		// The answer belongs to the phase it closed, so it is shown as that, never as this
		// phase's own. A cycle (`grill-with-docs` ↔ `prototype`) can re-enter a closed phase
		// without a reset, so the phase is compared, not assumed.
		const why = lastClosure && lastClosure.phase !== c?.name ? ` · закрыли ${lastClosure.phase}: ${lastClosure.answer}` : "";
		ui.setStatus(
			"skill-guard",
			c ? `phase: ${c.name} → ${c.successors.join(" | ") || "—"}${why}` : undefined,
		);
	};

	/** Where a subagent reads the phase from: the parent's file, never its own. */
	const parentFile = (ctx: unknown): string | null => {
		const c = ctx as { cwd?: string };
		const root = c.cwd ? findRoot(c.cwd) : null;
		return inherited && root ? statePath(root, inherited) : null;
	};

	/**
	 * Every state change ends here: the file learns about it and so does the status line. One
	 * call instead of the same three in every handler, and the file is found here, once.
	 */
	const commit = (ctx: unknown) => {
		// A child has no file of its own: it inherited the parent's phase to use, not to write.
		if (!inherited) sessionFile ??= fileFor(ctx);
		persist();
		showPhase((ctx as { ui: { setStatus: (key: string, text: string | undefined) => void } }).ui);
	};

	const reset = () => {
		state.phase = null;
		state.gatesPassed = [];
		delete state.spec;
		allowed.clear();
		lastClosure = null;
	};

	/** What `/matt` shows: the phase, what it allows, and what still has to be closed. */
	const report = () => {
		const c = contractOf(CONTRACTS, state.phase);
		if (!c) return "skill-guard: фаза не открыта";
		const gate = needsGate(CONTRACTS, state);
		return [
			`фаза: ${c.name}`,
			...(c.needsSpec || state.spec ? [`спека: ${state.spec?.ref ?? "не названа"}`] : []),
			`осталось: ${state.tickets === undefined ? "неизвестно — прогони проверку" : `${state.tickets} открытых тикетов`}`,
			`разрешено: ${c.grants.join(", ")}`,
			`дальше: ${c.successors.join(", ") || "—"}`,
			gate ? `открытый гейт: ${gateText(gate)}` : "гейт: закрыт",
			saveError ? `состояние НЕ сохранено: ${saveError}` : `состояние: ${sessionFile ?? "некуда сохранять"}`,
		].join("\n");
	};

	pi.on("session_start", (_event, ctx) => {
		// In a child the file belongs to the parent and is read-only: this process must not
		// write into another session's state, so it has nowhere to save and needs no place.
		const parent = parentFile(ctx);
		sessionFile = parent ? null : fileFor(ctx);
		reset();
		// A restored phase is the whole point of the file: without it a reload drops the guard.
		// Everything the file holds comes back. A field the restore lists by hand is a field
		// it can forget — `tickets` was exactly that: after every reload the block said
		// «неизвестно», and the count had to be earned again by running the check.
		const source = parent ?? sessionFile;
		const saved = source ? readState(source) : null;
		if (saved) Object.assign(state, saved);
		commit(ctx);
	});

	// `/skill:name` is expanded into the prompt without a `read` call, so the user's own
	// way in has to set the phase here. The order between those skills is the user's
	// call — they typed it — so this is not checked against successors.
	pi.on("input", (event, ctx) => {
		// A new user turn starts with its own budget of continuations.
		continues = 0;
		// The child's phase belongs to the parent: naming one here would move it locally and
		// look like a flow step that never happened.
		if (inherited) return;
		const m = /^\/skill:([\w-]+)/.exec(event.text.trim());
		const name = m?.[1];
		// A typo, or a skill outside the flow, must not look armed: only a contract makes a
		// phase. `research` or a sub-skill named here leaves the flow as it is.
		if (!name || !contractOf(CONTRACTS, name)) return;
		state.phase = name;
		state.gatesPassed = [];
		allowed.clear();
		lastClosure = null;
		commit(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		const input = (event as { input?: Record<string, unknown> }).input ?? {};

		// Entering a phase: the model reads that phase's SKILL.md. A `/skill:<name>` mention
		// is not a path and is handled in the `input` handler above.
		if (event.toolName === "read" && typeof input.path === "string") {
			const name = skillNameFromPath(input.path);
			if (!name) return;

			const decision = decide(state, { kind: "skill", name }, CONTRACTS);
			if (!decision.allow) return { block: true, reason: decision.reason };

			// The child works inside the parent's phase and does not leave it: a subagent does one
			// slice, and its exit is not the flow's exit. Uncontracted skills stay readable.
			if (inherited && contractOf(CONTRACTS, name) && name !== state.phase) {
				return {
					block: true,
					reason: `Фаза «${state.phase}» принадлежит родительской сессии: сабагент её не меняет.`,
				};
			}

			// Leaving the current phase costs one question, asked here because this is
			// the moment the flow moves on and the model cannot answer it itself.
			const gate = name === state.phase || SUB_SKILLS.has(name) ? undefined : needsGate(CONTRACTS, state);
			if (gate && state.phase) {
				// A command gate is not a question: it waits for the tracker's own output, so the
				// move is refused until the model has run the check and it came back clean.
				if (gate.kind === "command") {
					const check = state.spec ? specCheck(state.spec.ref) : undefined;
					return {
						block: true,
						reason:
							`Фаза «${state.phase}» закрывается данными трекера, а не словом. ` +
							`Сначала: ${gate.hint}${check ? ` — ${check}` : ""}. Потом уже «${name}».`,
					};
				}
				if (!ctx.hasUI) {
					ctx.ui.notify(`skill-guard: гейт «${gate.question}» не спросить без UI`, "warning");
				} else {
					const answer = await ctx.ui.editor(gate.question, gate.quote);
					if (answer === undefined || answer.trim() === "") {
						return {
							block: true,
							reason:
								`Переход в «${name}» отменён: фаза «${state.phase}» не закрыта.\n` +
								`Условие конца фазы: ${gate.quote}`,
						};
					}
					state.gatesPassed.push(state.phase);
					lastClosure = { phase: state.phase, answer: answer.trim() };
					commit(ctx);
					ctx.ui.notify(`skill-guard: ответ записан → ${name}`, "info");
				}
			}

			// A phase that works on a spec has nothing to work on without one, and only the
			// user knows which spec this run is about — asked once, at the move.
			const entering = contractOf(CONTRACTS, decision.phase);
			if (entering?.needsSpec && !state.spec?.ref) {
				if (!ctx.hasUI) {
					ctx.ui.notify(`skill-guard: фаза «${entering.name}» без спеки — /matt spec <#issue|путь>`, "warning");
				} else {
					const ref = await ctx.ui.editor("На какую спеку работаем? #issue или путь", "");
					if (ref === undefined || ref.trim() === "") {
						return {
							block: true,
							reason:
								`Фаза «${entering.name}» работает по спеке, а спека не названа — переход отменён.\n` +
								`Назови её: /matt spec <#issue|путь>, потом прочитай SKILL.md снова.`,
						};
					}
					state.spec = { ref: ref.trim() };
					ctx.ui.notify(`skill-guard: спека → ${state.spec.ref}`, "info");
				}
			}

			if (decision.phase !== state.phase) {
				allowed.clear();
				// A phase entered again is a new visit: the answer that closed the last one is spent.
				state.gatesPassed = state.gatesPassed.filter((p) => p !== decision.phase);
			}
			state.phase = decision.phase;
			commit(ctx);
			return;
		}

		// A tool from an extension this guard knows nothing about: in a phase that cannot
		// run commands it could do anything, so it is the user's call, not ours.
		if (needsPermission(state, event.toolName, CONTRACTS)) {
			const key = `${state.phase}:${event.toolName}`;
			if (!allowed.has(key)) {
				if (!ctx.hasUI) {
					return {
						block: true,
						reason: `Инструмент «${event.toolName}» не разрешён в фазе «${state.phase}»: расширение его не знает, а без диалога спросить некого.`,
					};
				}
				const ok = await ctx.ui.confirm(
					`Разрешить «${event.toolName}»?`,
					`Фаза «${state.phase}» этот инструмент не знает — он может делать что угодно. Разрешить до конца фазы?`,
				);
				if (!ok) {
					return {
						block: true,
						reason: `«${event.toolName}» не разрешён в фазе «${state.phase}». Смени фазу или обойдись инструментами, которые она даёт.`,
					};
				}
				allowed.add(key);
			}
		}

		const decision = decide(state, { kind: "tool", tool: event.toolName }, CONTRACTS);
		if (!decision.allow) return { block: true, reason: decision.reason };
	});

	// The one gate a person does not have to answer: the runner already did. A command gate
	// closes on the tool's own output, so the model cannot close it by claiming it is done.
	pi.on("tool_result", (event, ctx) => {
		// The parent owns its gates: a child reporting a closed spec would close them for it.
		if (inherited) return;
		// Only a command can prove a tracker state; an edit or a read proves nothing.
		if (grantFor(event.toolName) !== "bash") return;
		// And only a read of the tracker: `printf 0` proves nothing, and `gh issue close 1` or
		// `gh issue list; echo 0` would close the gate with the model's own act.
		const command = typeof event.input?.command === "string" ? event.input.command : "";
		if (!trackerRead(command)) return;
		const output = event.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");

		// The tracker's last answer is the one number worth carrying past a compaction.
		if (!event.isError && state.spec) {
			const left = /^\s*(\d+)\s*$/m.exec(output);
			if (left) {
				state.tickets = Number(left[1]);
				commit(ctx);
			}
		}

		const c = contractOf(CONTRACTS, state.phase);
		const gate = needsGate(CONTRACTS, state);
		if (!c || !gate || gate.kind !== "command") return;
		if (!commandCloses(gate, event.isError, output)) return;
		state.gatesPassed.push(c.name);
		lastClosure = { phase: c.name, answer: new RegExp(gate.must, "m").exec(output)?.[0] ?? "—" };
		commit(ctx);
		ctx.ui.notify(`skill-guard: фаза «${c.name}» закрыта данными трекера`, "info");
	});

	// setStatus is invisible to the model, and a message written once is swallowed by the next
	// compaction: the block is rebuilt on every request, at the tail of the conversation.
	pi.on("context", (event) => {
		const block = phaseBlock(CONTRACTS, state);
		if (!block) return;
		return {
			messages: [
				...event.messages,
				{ role: "custom", customType: "skill-guard", content: block, display: false, timestamp: Date.now() },
			],
		};
	});

	// A turn that ended on an unclosed mechanical gate is not finished work: the model gets
	// the block back instead of silence. A human gate is never talked over — there the model
	// is waiting for an answer, not stuck — and the ceiling keeps this from looping.
	pi.on("agent_before_settle", (_event, ctx) => {
		if (continues >= MAX_CONTINUES) return;
		const gate = needsGate(CONTRACTS, state);
		if (gate?.kind !== "command") return;
		if (ctx.hasPendingMessages()) return;
		const block = phaseBlock(CONTRACTS, state);
		if (!block) return;
		continues++;
		return {
			continue: true,
			entries: [{ type: "custom_message", customType: "skill-guard", content: block, display: false }],
		};
	});

	// `/matt` is the only way back that does not need the model's cooperation.
	pi.registerCommand("matt", {
		description: "skill-guard: фаза, гейты; /matt goto <skill>; /matt spec <#issue|путь>",
		// Pi asks the command for its own argument hints; without this it has nothing to offer
		// after `/matt `. The phase names come from the same table the handler checks.
		getArgumentCompletions: (prefix: string) => {
			const goto = /^(goto\s+)([\w-]*)$/.exec(prefix);
			if (goto) {
				return CONTRACTS.filter((c) => c.name.startsWith(goto[2] ?? "")).map((c) => ({
					value: `${goto[1]}${c.name}`,
					label: c.name,
					description: `допускает: ${c.grants.join(", ")}`,
				}));
			}
			return ["goto ", "spec "]
				.filter((word) => word.startsWith(prefix))
				.map((word) => ({ value: word, label: word.trim(), description: word === "goto " ? "сменить фазу" : "назвать спеку" }));
		},
		handler: async (args, ctx) => {
			// `/matt` is the parent's control panel: a child may look at the phase and not move
			// it, because its own session ends with its answer.
			if (inherited && /^(goto|spec)\s/.test(args.trim())) {
				ctx.ui.notify("skill-guard: фаза унаследована от родителя — /matt goto и /matt spec здесь не работают", "warning");
				return;
			}
			if (!inherited) sessionFile ??= fileFor(ctx);
			const spec = /^spec\s+(.+)$/.exec(args.trim());
			if (spec) {
				state.spec = { ref: spec[1].trim() };
				commit(ctx);
				ctx.ui.notify(`skill-guard: спека → ${state.spec.ref}`, "info");
				return;
			}
			const goto = /^goto\s+([\w-]+)$/.exec(args.trim());
			if (!goto) {
				ctx.ui.notify(report(), "info");
				return;
			}
			const name = goto[1];
			// Only a contract makes a phase: `research` or a typo would arm nothing.
			if (!contractOf(CONTRACTS, name)) {
				ctx.ui.notify(`/matt goto: «${name}» — не фаза (нет контракта)`, "warning");
				return;
			}
			state.phase = name;
			state.gatesPassed = [];
			allowed.clear();
			lastClosure = null;
			commit(ctx);
			ctx.ui.notify(`skill-guard: фаза → ${name}`, "info");
		},
	});
}
