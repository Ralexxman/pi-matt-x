/**
 * Drives the adapter the way Pi would, without Pi: `pi.on` collects handlers, the test
 * calls them with an event and a fake ctx. This is the only place the wiring is checked —
 * the engine tests cannot see a wrong event name or a missing `block`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import register from "./index.ts";

function harness(answer: string | undefined, permission = true, context: Record<string, unknown> = {}) {
	const handlers: Record<string, ((event: unknown, ctx: unknown) => unknown)[]> = {};
	const commands: Record<string, (args: string, ctx: unknown) => Promise<void>> = {};
	let asked = 0;
	let confirmed = 0;
	const statuses: string[] = [];
	const notices: string[] = [];
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
		registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
			commands[name] = options.handler;
		},
	};
	register(pi as unknown as ExtensionAPI);
	const ctx = { ui, hasUI: true, ...context };
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
		asked: () => asked,
		confirmed: () => confirmed,
		status: () => statuses.at(-1) ?? "",
		notice: () => notices.at(-1) ?? "",
	};
}

const readSkill = (name: string) => ({ toolName: "read", input: { path: `C:/Users/ralex/.agents/skills/${name}/SKILL.md` } });
const write = { toolName: "write", input: { path: "a.ts", content: "x" } };

test("cold start lets any tool through", async () => {
	const h = harness("ok");
	assert.equal(await h.fire("tool_call", write), undefined);
});

test("reading a skill with no writes blocks write and allows read", async () => {
	const h = harness("ok");
	assert.equal(await h.fire("tool_call", readSkill("grilling")), undefined);
	assert.deepEqual((await h.fire("tool_call", write)) as object, {
		block: true,
		reason: "Фаза «grilling» разрешает только: read. Инструмент «write» — нет.\nДальше отсюда: grill-me, grill-with-docs, domain-modeling.",
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

	await h.command("matt", "goto research");
	assert.match(h.notice(), /не фаза/);
	assert.match(h.status(), /phase: to-tickets/, "a skill without a contract arms nothing");

	await h.command("matt", "goto implement-spec");
	assert.match(h.status(), /phase: implement-spec/);
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
	await h.fire("tool_result", { toolName: "bash", input: {}, content: [{ type: "text", text: "3" }], isError: false });
	assert.equal(((await h.fire("tool_call", readSkill("code-review"))) as { block?: boolean }).block, true);

	// neither does a check that failed
	await h.fire("tool_result", { toolName: "bash", input: {}, content: [{ type: "text", text: "0" }], isError: true });
	assert.equal(((await h.fire("tool_call", readSkill("code-review"))) as { block?: boolean }).block, true, "a failed command proves nothing");

	// the tracker's clean answer does
	await h.fire("tool_result", { toolName: "bash", input: {}, content: [{ type: "text", text: "0" }], isError: false });
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
