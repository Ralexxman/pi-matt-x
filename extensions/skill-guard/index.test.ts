/**
 * Drives the adapter the way Pi would, without Pi: `pi.on` collects handlers, the test
 * calls them with an event and a fake ctx. This is the only place the wiring is checked —
 * the engine tests cannot see a wrong event name or a missing `block`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import register from "./index.ts";

function harness(answer: string | undefined, permission = true) {
	const handlers: Record<string, ((event: unknown, ctx: unknown) => unknown)[]> = {};
	let asked = 0;
	let confirmed = 0;
	const ui = {
		setStatus() {},
		notify() {},
		editor: async () => {
			asked++;
			return answer;
		},
		confirm: async () => {
			confirmed++;
			return permission;
		},
	};
	const pi = { on: (name: string, fn: never) => (handlers[name] ??= []).push(fn) };
	register(pi as unknown as ExtensionAPI);
	const ctx = { ui, hasUI: true };
	const fire = async (name: string, event: unknown) => {
		for (const handler of handlers[name] ?? []) {
			const result = await handler(event, ctx);
			if (result) return result;
		}
		return undefined;
	};
	return { fire, asked: () => asked, confirmed: () => confirmed };
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
