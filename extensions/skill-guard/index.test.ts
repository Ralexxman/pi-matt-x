/**
 * Drives the adapter the way Pi would, without Pi: `pi.on` collects handlers, the test
 * calls them with an event and a fake ctx. This is the only place the wiring is checked —
 * the engine tests cannot see a wrong event name or a missing `block`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import register from "./index.ts";
import { CONTRACTS, SUB_SKILLS } from "./contracts.ts";

function harness(answer: string | undefined, permission = true, context: Record<string, unknown> = {}) {
	const handlers: Record<string, ((event: unknown, ctx: unknown) => unknown)[]> = {};
	const commands: Record<string, (args: string, ctx: unknown) => Promise<void>> = {};
	const registered: Record<string, { getArgumentCompletions?: (prefix: string) => { value: string; label: string }[] | null }> = {};
	let asked = 0;
	let confirmed = 0;
	const statuses: string[] = [];
	const notices: string[] = [];
	const sent: string[] = [];
	const ui = {
		setStatus(_key: string, text: string | undefined) {
			statuses.push(text ?? "");
		},
		notify(text: string) {
			notices.push(text);
		},
		editor: async () => {
			asked++;
			return answer;
		},
		confirm: async () => {
			confirmed++;
			return permission;
		},
	};
	const pi = {
		on: (name: string, fn: never) => (handlers[name] ??= []).push(fn),
		registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void>; getArgumentCompletions?: (prefix: string) => { value: string; label: string }[] | null }) => {
			commands[name] = options.handler;
			registered[name] = options;
		},
		// What a command says to the model: without it `/matt` moves the phase and the run stays idle.
		sendUserMessage: async (text: string) => {
			sent.push(text);
		},
	};
	register(pi as unknown as ExtensionAPI);
	const ctx = { ui, hasUI: true, hasPendingMessages: () => false, ...context };
	const fire = async (name: string, event: unknown) => {
		for (const handler of handlers[name] ?? []) {
			const result = await handler(event, ctx);
			if (result) return result;
		}
		return undefined;
	};
	const command = async (name: string, args: string) => {
		const handler = commands[name];
		assert.ok(handler, `command ${name} is registered`);
		await handler(args, ctx);
	};
	return {
		fire,
		command,
		completions: (prefix: string) => registered.matt?.getArgumentCompletions?.(prefix) ?? null,
		asked: () => asked,
		confirmed: () => confirmed,
		status: () => statuses.at(-1) ?? "",
		notice: () => notices.at(-1) ?? "",
		sent: () => sent,
	};
}

const readSkill = (name: string) => ({ toolName: "read", input: { path: `C:/Users/ralex/.agents/skills/${name}/SKILL.md` } });
const write = { toolName: "write", input: { path: "a.ts", content: "x" } };
const GH_COUNT = { command: "gh issue list --state open -q length" };

test("cold start lets any tool through", async () => {
	const h = harness("ok");
	assert.equal(await h.fire("tool_call", write), undefined);
});

test("reading a skill with no writes blocks write and allows read", async () => {
	const h = harness("ok");
	assert.equal(await h.fire("tool_call", readSkill("grilling")), undefined);
	assert.deepEqual((await h.fire("tool_call", write)) as object, {
		block: true,
		reason:
			"Фаза «grilling» разрешает только: read. Инструмент «write» — нет.\nДальше отсюда: grill-me, grill-with-docs, domain-modeling." +
			"\nФазу открывает пользователь: попроси его ввести /matt goto <фаза> и дождись его ввода.",
	});
	assert.equal(await h.fire("tool_call", { toolName: "read", input: { path: "src/a.ts" } }), undefined);
});

test("a non-successor skill is blocked and the gate question is never asked", async () => {
	const h = harness("ok");
	await h.fire("tool_call", readSkill("grilling"));
	const result = (await h.fire("tool_call", readSkill("to-spec"))) as { block?: boolean };
	assert.equal(result.block, true);
	assert.equal(h.asked(), 0, "a blocked move must not ask anything");
});

test("re-entering a phase spends its old answer, so leaving it again asks", async () => {
	const h = harness("да, идём");
	await h.fire("tool_call", readSkill("grill-with-docs"));
	await h.fire("tool_call", readSkill("prototype")); // answers the grill-with-docs gate
	await h.fire("tool_call", readSkill("grill-with-docs")); // the cycle back spends it
	await h.fire("tool_call", readSkill("to-spec"));
	assert.equal(h.asked(), 2, "the second visit needs its own answer");
});

test("the answer of a closed phase does not come back when a cycle re-enters it", async () => {
	// grill-with-docs ↔ prototype is a cycle of contracted phases, so this re-entry
	// needs no reset and asks no second gate (prototype has none).
	const h = harness("да, идём");
	await h.fire("tool_call", readSkill("grill-with-docs"));
	await h.fire("tool_call", readSkill("prototype")); // answers the gate of grill-with-docs
	assert.match(h.status(), /закрыли grill-with-docs: да, идём/);
	await h.fire("tool_call", readSkill("grill-with-docs"));
	assert.match(h.status(), /phase: grill-with-docs/);
	assert.doesNotMatch(h.status(), /да, идём/, "its own closed answer must not be shown as current");
});

test("the answer that closed a phase is recorded and does not survive a new session", async () => {
	const h = harness("да, идём");
	await h.fire("tool_call", readSkill("grilling"));
	await h.fire("tool_call", readSkill("grill-with-docs")); // the gate of grilling is answered here
	assert.match(h.status(), /закрыли grilling: да, идём/, "the answer is recorded with the phase it did close");
	await h.fire("session_start", {});
	assert.doesNotMatch(h.status(), /да, идём/, "a new session carries no answers from the last one");
});

test("the gate asks once, and an empty answer cancels the move", async () => {
	const cancelled = harness(undefined);
	await cancelled.fire("tool_call", readSkill("grilling"));
	const result = (await cancelled.fire("tool_call", readSkill("grill-with-docs"))) as { block?: boolean; reason?: string };
	assert.equal(result.block, true);
	assert.match(result.reason ?? "", /не закрыта/);
	assert.equal(cancelled.asked(), 1);

	const accepted = harness("да, идём");
	await accepted.fire("tool_call", readSkill("grilling"));
	assert.equal(await accepted.fire("tool_call", readSkill("grill-with-docs")), undefined);
	assert.equal(await accepted.fire("tool_call", readSkill("grill-with-docs")), undefined, "re-reading the same skill");
	assert.equal(accepted.asked(), 1, "the gate of a phase that is not being left must not be asked");
});

test("the interview step of grill-with-docs asks no gate", async () => {
	const h = harness("ok");
	await h.fire("tool_call", readSkill("grill-with-docs"));
	assert.equal(await h.fire("tool_call", readSkill("grilling")), undefined, "grilling is reachable from grill-with-docs");
	assert.equal(h.asked(), 0, "running the interview is not a phase boundary");
	assert.equal(await h.fire("tool_call", readSkill("grill-with-docs")), undefined, "and back out of it");
});

test("to-tickets can write its ticket files", async () => {
	const h = harness("ok");
	await h.fire("tool_call", readSkill("to-tickets"));
	assert.equal(await h.fire("tool_call", write), undefined);
});

test("an unknown tool in a guarded phase is the user's call, asked once", async () => {
	const denied = harness("ok", false);
	await denied.fire("tool_call", readSkill("grilling"));
	const result = (await denied.fire("tool_call", { toolName: "mcp_search", input: {} })) as { block?: boolean };
	assert.equal(result.block, true);
	assert.equal(denied.confirmed(), 1);

	const allowed = harness("ok", true);
	await allowed.fire("tool_call", readSkill("grilling"));
	assert.equal(await allowed.fire("tool_call", { toolName: "mcp_search", input: {} }), undefined);
	assert.equal(await allowed.fire("tool_call", { toolName: "mcp_search", input: {} }), undefined);
	assert.equal(allowed.confirmed(), 1, "the same pair is not asked again");
});

test("reading an uncontracted skill does not lift the phase", async () => {
	const h = harness("ok");
	await h.fire("tool_call", readSkill("grilling"));
	assert.equal(await h.fire("tool_call", readSkill("research")), undefined, "the skill is readable");
	const result = (await h.fire("tool_call", write)) as { block?: boolean };
	assert.equal(result.block, true, "but grilling's restriction stays");
});

test("/skill: of a skill without a contract does not lift the open phase", async () => {
	const h = harness("ok");
	await h.fire("tool_call", readSkill("to-spec"));
	await h.fire("input", { text: "/skill:domain-modeling", source: "interactive" });
	const result = (await h.fire("tool_call", write)) as { block?: boolean };
	assert.equal(result.block, true, "a skill with no contract is not a phase");
});

test("/skill: with a name the guard does not know arms nothing", async () => {
	const h = harness("ok");
	await h.fire("input", { text: "/skill:implemet", source: "interactive" });
	assert.equal(await h.fire("tool_call", write), undefined, "a typo must not look armed");
	await h.fire("input", { text: "/skill:grilling", source: "interactive" });
	assert.equal(((await h.fire("tool_call", write)) as { block?: boolean }).block, true, "a known phase still arms");
});

test("/skill:name sets the phase without a read", async () => {
	const h = harness("ok");
	await h.fire("input", { text: "/skill:implement do the thing", source: "interactive" });
	assert.equal(await h.fire("tool_call", write), undefined, "implement writes");
	assert.equal(await h.fire("tool_call", readSkill("wayfinder")) === undefined, true, "an uncontracted skill is reachable");
});

// A project dir with a `.pi` marker, so the state file has somewhere to live.
function project() {
	const root = mkdtempSync(join(tmpdir(), "skill-guard-"));
	mkdirSync(join(root, ".pi"));
	return { cwd: root, sessionManager: { getSessionId: () => "session-1" } };
}

test("the ticket count comes back with the phase after a reload", async () => {
	const context = project();
	const before = harness("#42", true, context);
	await before.fire("session_start", {});
	await before.fire("tool_call", readSkill("implement-spec"));
	await before.fire("tool_result", { toolName: "bash", input: GH_COUNT, content: [{ type: "text", text: "2\n" }], isError: false });

	// A new instance on the same file: what was written is what comes back, and the block
	// says how much is left without earning the number again.
	const after = harness("#42", true, context);
	await after.fire("session_start", {});
	type Msg = { content: string };
	const block = (await after.fire("context", { messages: [] })) as { messages: Msg[] };
	assert.match(block.messages[0]?.content ?? "", /2 открытых тикетов/);
});

/** Runs `fn` with the environment a subagent process sees, then puts the environment back. */
async function asChild<T>(fn: () => T): Promise<T> {
	process.env.PI_SUBAGENT_CHILD = "1";
	process.env.PI_SUBAGENT_PARENT_SESSION = "session-1";
	try {
		return await fn();
	} finally {
		delete process.env.PI_SUBAGENT_CHILD;
		delete process.env.PI_SUBAGENT_PARENT_SESSION;
	}
}

/** The same, but with no parent session named: a child with nothing to inherit. */
async function asChildWithoutParent<T>(fn: () => T): Promise<T> {
	process.env.PI_SUBAGENT_CHILD = "1";
	delete process.env.PI_SUBAGENT_PARENT_SESSION;
	try {
		return await fn();
	} finally {
		delete process.env.PI_SUBAGENT_CHILD;
	}
}

/** A parent already inside implement-spec with a spec, and the child that inherits it. */
async function parentAndChild() {
	const context = project();
	const parent = harness("#42", true, context);
	await parent.fire("session_start", {});
	await parent.fire("tool_call", readSkill("implement-spec"));
	const child = await asChild(() => harness("#42", true, { ...context, sessionManager: { getSessionId: () => "child-1" } }));
	await child.fire("session_start", {});
	return { context, parent, child };
}

test("a subagent starts in the phase its parent left open", async () => {
	const { child } = await parentAndChild();
	assert.match(child.status(), /phase: implement-spec/, "no cold start without a guard");
});

test("a subagent cannot move the parent's phase", async () => {
	const { child } = await parentAndChild();

	// The control panel belongs to the parent: a child may look at the phase, not move it.
	await child.command("matt", "goto pr");
	assert.match(child.notice(), /унаследована/);
	assert.match(child.status(), /phase: implement-spec/);

	// Nor by naming a phase in the prompt.
	await child.fire("input", { text: "/skill:pr", source: "interactive" });
	assert.match(child.status(), /phase: implement-spec/);

	// Nor by reading another phase's SKILL.md.
	const move = (await child.fire("tool_call", readSkill("code-review"))) as { block?: boolean; reason?: string };
	assert.equal(move.block, true);
	assert.match(move.reason ?? "", /принадлежит родительской сессии/);
});

test("a subagent does not close the parent's gate, and writes no file of its own", async () => {
	const { context, parent, child } = await parentAndChild();
	await child.fire("tool_result", { toolName: "bash", input: GH_COUNT, content: [{ type: "text", text: "0\n" }], isError: false });

	type Msg = { content: string };
	const gate = (await parent.fire("context", { messages: [] })) as { messages: Msg[] };
	assert.match(gate.messages[0]?.content ?? "", /гейт открыт/, "the parent still has work to close");
	assert.equal(existsSync(join(String(context.cwd), ".pi", "skills-guard", "sessions", "child-1.json")), false, "a child writes no state file");
});

test("a subagent in a project the guard never ran in is not blocked", async () => {
	// A parent id is set but no state file exists: this project has no guard to inherit, and
	// blocking every tool here breaks unrelated work in a foreign repository.
	const child = await asChild(() => harness("#42", true, project()));
	await child.fire("session_start", {});
	assert.equal(await child.fire("tool_call", write), undefined, "nothing to inherit, nothing to block");
	assert.doesNotMatch(child.status(), /phase: /, "and no phase is armed");
});

test("a subagent inherits a session that simply has no phase open", async () => {
	// What a cold session writes: the guard ran, and nothing was open. That is not a broken state,
	// so a subagent in such a project keeps its tools.
	const context = project();
	const sessions = join(String(context.cwd), ".pi", "skills-guard", "sessions");
	mkdirSync(sessions, { recursive: true });
	writeFileSync(join(sessions, "session-1.json"), JSON.stringify({ phase: null, gatesPassed: [] }));

	const child = await asChild(() => harness("#42", true, context));
	await child.fire("session_start", {});
	assert.equal(await child.fire("tool_call", write), undefined, "no phase to inherit, nothing to block");
	assert.doesNotMatch(child.status(), /phase: /);
});

test("a subagent whose parent state exists but cannot be read stops", async () => {
	// The guard was in play in that session: a half-written file must not turn into freedom.
	const context = project();
	const sessions = join(String(context.cwd), ".pi", "skills-guard", "sessions");
	mkdirSync(sessions, { recursive: true });
	writeFileSync(join(sessions, "session-1.json"), "{ not json");

	const child = await asChild(() => harness("#42", true, context));
	await child.fire("session_start", {});
	const blocked = (await child.fire("tool_call", write)) as { block?: boolean; reason?: string };
	assert.equal(blocked.block, true);
	assert.match(blocked.reason ?? "", /фазу родителя/);
	await child.command("matt", "");
	assert.match(child.notice(), /недоступна/);
});

test("a subagent with no parent session named is not blocked either", async () => {
	const child = await asChildWithoutParent(() => harness("#42", true, project()));
	await child.fire("session_start", {});
	assert.equal(await child.fire("tool_call", write), undefined);
});

test("a reload keeps the phase the last session ended in", async () => {
	const context = project();

	const before = harness("ok", true, context);
	await before.fire("session_start", {});
	assert.equal(await before.fire("tool_call", readSkill("to-spec")), undefined);
	assert.match(before.status(), /phase: to-spec/);

	// The same session id and cwd is what `/reload` gives the fresh factory.
	const after = harness("ok", true, context);
	await after.fire("session_start", {});
	assert.match(after.status(), /phase: to-spec/, "the guard does not start cold after a reload");
	assert.equal((await after.fire("tool_call", write)) === undefined, false, "and to-spec still refuses writes");
});

test("/matt reports the restored phase and moves it", async () => {
	const h = harness("ok", true, project());
	await h.fire("session_start", {});
	await h.fire("tool_call", readSkill("to-tickets"));
	await h.command("matt", "");
	assert.match(h.notice(), /фаза: to-tickets/);
	assert.equal(h.sent().length, 0, "a bare /matt is a look, not a prompt");

	await h.command("matt", "goto research");
	assert.match(h.notice(), /не фаза/);
	assert.match(h.status(), /phase: to-tickets/, "a skill without a contract arms nothing");

	await h.command("matt", "goto implement-spec");
	assert.match(h.status(), /phase: implement-spec/);
	assert.match(h.sent().at(-1) ?? "", /фаза → implement-spec/, "the move wakes the model instead of leaving it idle");
	assert.equal(((await h.fire("tool_call", write)) as { block?: boolean }).block, true, "implement-spec needs a spec first");
	await h.command("matt", "spec #42");
	assert.match(h.notice(), /#42/);
	assert.equal(await h.fire("tool_call", write), undefined, "the phase it moved to grants writes");
});

test("entering implement-spec asks for the spec, and no answer cancels the move", async () => {
	const cancelled = harness("");
	const result = (await cancelled.fire("tool_call", readSkill("implement-spec"))) as { block?: boolean; reason?: string };
	assert.equal(result.block, true);
	assert.match(result.reason ?? "", /спек/);
	assert.equal(cancelled.asked(), 1, "asked exactly once, at the move");

	const named = harness("#42");
	assert.equal(await named.fire("tool_call", readSkill("implement-spec")), undefined, "a named spec lets the move through");
	assert.equal(named.asked(), 1);
	assert.match(named.status(), /phase: implement-spec/);
	assert.equal(await named.fire("tool_call", write), undefined, "and the phase can write");
});

test("the spec is asked once per session, not on every read", async () => {
	const h = harness("#42");
	await h.fire("tool_call", readSkill("implement-spec"));
	await h.fire("tool_call", readSkill("implement-spec"));
	assert.equal(h.asked(), 1, "the spec is already named");
});

test("the spec survives a reload with the phase", async () => {	const context = project();
	const before = harness("#42", true, context);
	await before.fire("session_start", {});
	await before.fire("tool_call", readSkill("implement-spec"));

	// A reload asks nothing new: the spec came back from the file.
	const after = harness("", true, context);
	await after.fire("session_start", {});
	assert.match(after.status(), /phase: implement-spec/);
	assert.equal(await after.fire("tool_call", write), undefined, "no spec dialog after a reload");
	assert.equal(after.asked(), 0);
});

test("implement-spec leaves only for a closed spec, as the tracker reports it", async () => {
	const h = harness("#42");
	await h.fire("tool_call", readSkill("implement-spec"));
	const open = (await h.fire("tool_call", readSkill("code-review"))) as { block?: boolean; reason?: string };
	assert.equal(open.block, true);
	assert.match(open.reason ?? "", /трекер/);

	// tickets still open prove nothing
	await h.fire("tool_result", { toolName: "bash", input: GH_COUNT, content: [{ type: "text", text: "3" }], isError: false });
	assert.equal(((await h.fire("tool_call", readSkill("code-review"))) as { block?: boolean }).block, true);

	// neither does a check that failed
	await h.fire("tool_result", { toolName: "bash", input: GH_COUNT, content: [{ type: "text", text: "0" }], isError: true });
	assert.equal(((await h.fire("tool_call", readSkill("code-review"))) as { block?: boolean }).block, true, "a failed command proves nothing");

	// nor a zero someone typed instead of asked for
	await h.fire("tool_result", { toolName: "bash", input: { command: "printf 0" }, content: [{ type: "text", text: "0" }], isError: false });
	assert.equal(((await h.fire("tool_call", readSkill("code-review"))) as { block?: boolean }).block, true, "only the tracker talks");

	// the tracker's clean answer does
	await h.fire("tool_result", { toolName: "bash", input: GH_COUNT, content: [{ type: "text", text: "0" }], isError: false });
	assert.equal(await h.fire("tool_call", readSkill("code-review")), undefined);
});

test("a result from a tool that is not a command never closes the gate", async () => {
	const h = harness("#42");
	await h.fire("tool_call", readSkill("implement-spec"));
	await h.fire("tool_result", { toolName: "read", input: {}, content: [{ type: "text", text: "0" }], isError: false });
	assert.equal(((await h.fire("tool_call", readSkill("code-review"))) as { block?: boolean }).block, true);
});

test("/matt shows the command gate as a check to run, with the command", async () => {
	const h = harness("#42", true, project());
	await h.fire("session_start", {});
	await h.fire("tool_call", readSkill("implement-spec"));
	await h.command("matt", "");
	assert.match(h.notice(), /проверку/);
	assert.match(h.status(), /phase: implement-spec/);
});

test("/matt completes its own arguments", async () => {
	const h = harness("#42");
	// Nothing typed yet: the two words the command understands.
	assert.deepEqual(h.completions("")?.map((i) => i.value), ["goto ", "spec "]);
	// A phase prefix narrows to phases, and the value keeps the word the handler parses.
	assert.deepEqual(h.completions("goto impl")?.map((i) => i.value), ["goto implement", "goto implement-spec"]);
	const full = h.completions("goto implement");
	assert.equal(full?.length, 2, "implement is a prefix of implement-spec, both stay offerable");
	assert.deepEqual(h.completions("goto ")?.length, CONTRACTS.length + SUB_SKILLS.size, "every phase and every sub-skill is offerable");
	// A sub-skill the flow names as a next step must be offerable — and it is no phase.
	assert.deepEqual(h.completions("goto domain")?.map((i) => i.value), ["goto domain-modeling"]);
});

test("/matt goto on a sub-skill keeps the phase and says so", async () => {
	const h = harness("#42");
	await h.fire("session_start", {});
	await h.fire("tool_call", readSkill("grilling"));
	await h.command("matt", "goto domain-modeling");
	assert.match(h.status(), /phase: grilling/, "a sub-skill is not a phase: the guard stays armed");
	assert.match(h.notice(), /под-скилл/);
	assert.match(h.sent().at(-1) ?? "", /domain-modeling/);
});

test("every request carries the phase block, exactly once", async () => {
	const h = harness("#42");
	assert.equal(await h.fire("context", { messages: [] }), undefined, "no phase, no block");

	await h.fire("tool_call", readSkill("implement-spec"));
	type Msg = { customType?: string; content: string };
	const first = (await h.fire("context", { messages: [{ role: "user", content: "x" }] })) as { messages: Msg[] };
	assert.equal(first.messages.length, 2);
	assert.equal(first.messages.filter((m) => m.customType === "skill-guard").length, 1, "not once per handler");
	assert.match(first.messages[1]?.content ?? "", /фаза: implement-spec/);

	// The same state gives the same text, so only the tail of the prompt changes.
	const second = (await h.fire("context", { messages: [] })) as { messages: Msg[] };
	assert.equal(second.messages[0]?.content, first.messages[1]?.content);
});

test("the tracker's count reaches the block, and no count is not a zero", async () => {
	const h = harness("#42");
	await h.fire("tool_call", readSkill("implement-spec"));
	type Msg = { content: string };
	const before = (await h.fire("context", { messages: [] })) as { messages: Msg[] };
	assert.match(before.messages[0]?.content ?? "", /осталось: неизвестно/);

	await h.fire("tool_result", { toolName: "bash", input: GH_COUNT, content: [{ type: "text", text: "3\n" }], isError: false });
	const after = (await h.fire("context", { messages: [] })) as { messages: Msg[] };
	assert.match(after.messages[0]?.content ?? "", /3 открытых тикетов/);
});

type Boundary = { continue?: boolean; entries?: { type: string; content: string }[] };

test("an unclosed command gate asks for a continuation instead of silence", async () => {
	const h = harness("#42");
	await h.fire("tool_call", readSkill("implement-spec"));
	const result = (await h.fire("agent_before_settle", {})) as Boundary;
	assert.equal(result.continue, true);
	assert.equal(result.entries?.length, 1, "one runnable entry, or Pi refuses the continuation");
	assert.equal(result.entries?.[0]?.type, "custom_message");
	assert.match(result.entries?.[0]?.content ?? "", /implement-spec/);
});

test("a human gate is never talked over", async () => {
	const h = harness("ok");
	await h.fire("tool_call", readSkill("to-tickets"));
	assert.equal(await h.fire("agent_before_settle", {}), undefined, "the model is waiting for an answer, not stuck");
});

test("a closed gate ends the turn, and the ceiling stops a loop", async () => {
	const closed = harness("#42");
	await closed.fire("tool_call", readSkill("implement-spec"));
	await closed.fire("tool_result", { toolName: "bash", input: GH_COUNT, content: [{ type: "text", text: "CLOSED" }], isError: false });
	assert.equal(await closed.fire("agent_before_settle", {}), undefined);

	const stuck = harness("#42");
	await stuck.fire("tool_call", readSkill("implement-spec"));
	const answers = [];
	for (let i = 0; i < 4; i++) answers.push(await stuck.fire("agent_before_settle", {}));
	assert.deepEqual(answers.slice(0, 3).map((r) => (r as Boundary).continue), [true, true, true]);
	assert.equal(answers[3], undefined, "the fourth turn is allowed to end");

	// A new user turn gets its own budget.
	await stuck.fire("input", { text: "продолжай", source: "interactive" });
	assert.equal(((await stuck.fire("agent_before_settle", {})) as Boundary).continue, true);
});

test("a command about another issue does not close the gate", async () => {
	// The gate asks about #42; a closed #1 says nothing about it, even though it reads the
	// tracker and prints CLOSED.
	const h = harness("#42");
	await h.fire("tool_call", readSkill("implement-spec"));
	await h.fire("tool_result", { toolName: "bash", input: { command: "gh issue view 1 --json state -q .state" }, content: [{ type: "text", text: "CLOSED" }], isError: false });
	const move = (await h.fire("tool_call", readSkill("code-review"))) as { block?: boolean };
	assert.equal(move.block, true, "#42 is still open as far as this command knows");

	// The same command, about the spec itself, does close it.
	await h.fire("tool_result", { toolName: "bash", input: { command: "gh issue view 42 --json state -q .state" }, content: [{ type: "text", text: "CLOSED" }], isError: false });
	assert.equal(await h.fire("tool_call", readSkill("code-review")), undefined);
});

test("a composite or mutating command does not close the gate", async () => {
	const h = harness("#42");
	await h.fire("tool_call", readSkill("implement-spec"));

	// Each of these prints a zero, and none of them is the tracker answering.
	for (const command of ["gh issue list --state open; echo 0", "gh issue list --state open && echo 0", "gh issue close 1", "gh issue edit 1 --body x", "printf 0"]) {
		await h.fire("tool_result", { toolName: "bash", input: { command }, content: [{ type: "text", text: "0\n" }], isError: false });
		const move = (await h.fire("tool_call", readSkill("code-review"))) as { block?: boolean };
		assert.equal(move.block, true, `${command} must not close the gate`);
	}

	// A read of the tracker does close it.
	await h.fire("tool_result", { toolName: "bash", input: { command: "gh issue list --state open -q length" }, content: [{ type: "text", text: "0\n" }], isError: false });
	assert.equal(await h.fire("tool_call", readSkill("code-review")), undefined);
});

test("without a UI the gate is announced, not asked, and the move goes through", async () => {
	const h = harness("ok", true, { hasUI: false });
	await h.fire("tool_call", readSkill("grilling"));
	assert.equal(await h.fire("tool_call", readSkill("grill-with-docs")), undefined, "headless must not deadlock");
	assert.match(h.notice(), /не спросить без UI/);
	assert.equal(h.asked(), 0, "there is no dialog to ask in");
});

test("without a UI the missing spec is announced and the move goes through", async () => {
	const h = harness(undefined, true, { hasUI: false });
	assert.equal(await h.fire("tool_call", readSkill("implement-spec")), undefined);
	assert.match(h.notice(), /без спеки/);
	assert.match(h.status(), /phase: implement-spec/);
});

test("without a UI an unknown tool is blocked, not guessed", async () => {
	const h = harness("ok", true, { hasUI: false });
	await h.fire("tool_call", readSkill("grilling"));
	const result = (await h.fire("tool_call", { toolName: "mcp_search", input: {} })) as { block?: boolean; reason?: string };
	assert.equal(result.block, true);
	assert.match(result.reason ?? "", /без диалога/);
});

test("a state file that cannot be written is reported, and the session keeps its guard", async () => {
	const context = project();
	// A file where the directory must be: mkdir fails, the write fails, the phase still holds.
	writeFileSync(join(String(context.cwd), ".pi", "skills-guard"), "not a directory");
	const h = harness("ok", true, context);
	await h.fire("session_start", {});
	await h.fire("tool_call", readSkill("to-spec"));
	await h.command("matt", "");
	assert.match(h.notice(), /НЕ сохранено/, "a silent failure would look like a saved phase");
	assert.match(h.status(), /phase: to-spec/);
	assert.equal(((await h.fire("tool_call", write)) as { block?: boolean }).block, true, "the guard still guards");
});

test("a turn that ends with a queued message is not continued", async () => {
	const h = harness("#42", true, { hasPendingMessages: () => true });
	await h.fire("tool_call", readSkill("implement-spec"));
	assert.equal(await h.fire("agent_before_settle", {}), undefined, "someone is already waiting in the queue");
});
