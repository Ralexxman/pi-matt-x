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
 * shortcut: the phase lives in memory only, so /reload or a resumed session starts
 * unguarded until the next SKILL.md read. Persist it if that turns out to hurt.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONTRACTS, SUB_SKILLS } from "./contracts.ts";
import { contractOf, decide, needsGate, needsPermission, skillNameFromPath, type GuardState } from "./engine.ts";

export default function (pi: ExtensionAPI): void {
	const state: GuardState = { phase: null, gatesPassed: [] };
	/** `${phase}:${tool}` the user already allowed, so one answer does not cost a dialog per call. */
	const allowed = new Set<string>();
	/** The last answer that closed a phase: history for the next one, never the current one's own. */
	let lastClosure: { phase: string; answer: string } | null = null;

	const showPhase = (ui: { setStatus: (key: string, text: string | undefined) => void }) => {
		const c = contractOf(CONTRACTS, state.phase);
		// The answer belongs to the phase it closed, so it is shown as that, never as this
		// phase's own condition. Returning into a closed phase is impossible without a
		// reset, so an older answer cannot survive into it.
		const why = lastClosure ? ` · закрыли ${lastClosure.phase}: ${lastClosure.answer}` : "";
		ui.setStatus(
			"skill-guard",
			c ? `phase: ${c.name} → ${c.successors.join(" | ") || "—"}${why}` : undefined,
		);
	};

	const reset = () => {
		state.phase = null;
		state.gatesPassed = [];
		allowed.clear();
		lastClosure = null;
	};

	pi.on("session_start", (_event, ctx) => {
		reset();
		showPhase(ctx.ui);
	});

	// `/skill:name` is expanded into the prompt without a `read` call, so the user's own
	// way in has to set the phase here. The order between those skills is the user's
	// call — they typed it — so this is not checked against successors.
	pi.on("input", (event, ctx) => {
		const m = /^\/skill:([\w-]+)/.exec(event.text.trim());
		const name = m?.[1];
		// A typo, or a skill outside the flow, must not look armed: only a contract makes a
		// phase. `research` or a sub-skill named here leaves the flow as it is.
		if (!name || !contractOf(CONTRACTS, name)) return;
		state.phase = name;
		state.gatesPassed = [];
		allowed.clear();
		lastClosure = null;
		showPhase(ctx.ui);
	});

	pi.on("tool_call", async (event, ctx) => {
		const input = (event as { input?: Record<string, unknown> }).input ?? {};

		// Entering a phase: the model reads that phase's SKILL.md (or a `/name` mention).
		if (event.toolName === "read" && typeof input.path === "string") {
			const name = skillNameFromPath(input.path);
			if (!name) return;

			const decision = decide(state, { kind: "skill", name }, CONTRACTS);
			if (!decision.allow) return { block: true, reason: decision.reason };

			// Leaving the current phase costs one question, asked here because this is
			// the moment the flow moves on and the model cannot answer it itself.
			const gate = name === state.phase || SUB_SKILLS.has(name) ? undefined : needsGate(CONTRACTS, state);
			if (gate && state.phase) {
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
					ctx.ui.notify(`skill-guard: ответ записан → ${name}`, "info");
				}
			}

			if (decision.phase !== state.phase) allowed.clear();
			state.phase = decision.phase;
			showPhase(ctx.ui);
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
}
