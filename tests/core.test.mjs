// Run with: node --test tests/
// Mock nodes mirror the real sockets/widgets of basic_data_handling and
// DictTools nodes as the current ComfyUI frontend creates them (widget-backed
// inputs appear in node.inputs with a `widget: { name }` reference).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	classify, findCounterparts, buildMenuItem, menuItemsFor, keysFromDictText, nodeDefMentionsDict,
} from "../web/dict_key_nav_core.js";

let nextId = 1;
function node({ cls, title, inputs = [], outputs = [], widgets = {}, links = {} }) {
	const n = {
		id: nextId++,
		comfyClass: cls,
		type: cls,
		title: title ?? cls,
		outputs: outputs.map(([name, type]) => ({ name, type })),
		widgets: Object.entries(widgets).map(([name, value]) => ({ name, value })),
		inputs: inputs.map(([name, type]) => ({
			name, type,
			link: links[name] ? 999 : null,
			...(name in widgets ? { widget: { name } } : {}),
		})),
	};
	n.getInputNode = (slot) => links[n.inputs[slot]?.name] ?? null;
	return n;
}
const BDH = (s) => `Basic data handling: ${s}`;
const DT = (s) => `${s} [Dict Tools]`;

const bdhCreate = (pairs) => node({
	cls: BDH("DictCreate"),
	inputs: pairs.flatMap((_, i) => [[`key_${i}`, "STRING"], [`value_${i}`, "*"]]),
	outputs: [["dict", "DICT"]],
	widgets: Object.fromEntries(pairs.flatMap(([k, v], i) => [[`key_${i}`, k], [`value_${i}`, v]])),
});
const bdhSet = (key) => node({ cls: BDH("DictSet"), inputs: [["input_dict", "DICT"], ["key", "STRING"], ["value", "*"]], outputs: [["dict", "DICT"]], widgets: { key } });
const bdhGet = (key, links) => node({ cls: BDH("DictGet"), inputs: [["input_dict", "DICT"], ["key", "STRING"], ["default", "*"]], outputs: [["value", "*"]], widgets: { key }, links });
const bdhPop = (key) => node({ cls: BDH("DictPop"), inputs: [["input_dict", "DICT"], ["key", "STRING"], ["default_value", "*"]], outputs: [["dict", "DICT"], ["value", "*"]], widgets: { key } });
const bdhRemove = (key) => node({ cls: BDH("DictRemove"), inputs: [["input_dict", "DICT"], ["key", "STRING"]], outputs: [["dict", "DICT"], ["key_removed", "BOOLEAN"]], widgets: { key } });
const bdhContains = (key) => node({ cls: BDH("DictContainsKey"), inputs: [["input_dict", "DICT"], ["key", "STRING"]], outputs: [["contains", "BOOLEAN"]], widgets: { key } });
const bdhSetDefault = (key) => node({ cls: BDH("DictSetDefault"), inputs: [["input_dict", "DICT"], ["key", "STRING"], ["default_value", "*"]], outputs: [["DICT", "DICT"], ["value", "*"]], widgets: { key } });
const dtExtractInt = (key) => node({ cls: DT("DictExtractInt"), inputs: [["dict", "DICT"], ["key", "STRING"], ["cleanup_key", "BOOLEAN"]], outputs: [["value", "INT"]], widgets: { key, cleanup_key: true } });
const dtAddInt = (key) => node({ cls: DT("DictAddInt"), inputs: [["dict", "DICT"], ["key", "STRING"], ["cleanup_key", "BOOLEAN"], ["value", "INT"]], outputs: [["dict", "DICT"]], widgets: { key, cleanup_key: true, value: 0 } });
const dtTextToDict = (text) => node({ cls: DT("TextToDict"), inputs: [["pre_cleanup", "BOOLEAN"], ["dict_text", "STRING"], ["show_status", "BOOLEAN"], ["dict", "DICT"]], outputs: [["dict", "DICT"]], widgets: { pre_cleanup: true, dict_text: text, show_status: false } });
const dtLegacyExtractString = (name) => node({ cls: "StringConstructorDictExtractString", inputs: [["name", "STRING"], ["show_status", "BOOLEAN"], ["dict", "DICT"]], outputs: [["value", "STRING"]], widgets: { name, show_status: false } });
const primitive = (value) => node({ cls: "PrimitiveString", outputs: [["STRING", "STRING"]], widgets: { value } });
const reroute = (src) => node({ cls: "Reroute", inputs: [["", "*"]], outputs: [["", "*"]], links: { "": src } });

function graphOf(nodes, extra = {}) {
	const g = { nodes, ...extra };
	for (const n of nodes) n.graph = g;
	return g;
}

const jumps = [];
const fallbacks = [];
const env = {
	label: (n) => `${n.title} #${n.id}`,
	jump: (n) => jumps.push(n),
	openFallback: (options, title) => fallbacks.push({ options, title }),
};

test("classification of basic_data_handling nodes", () => {
	assert.deepEqual(classify(bdhCreate([["a", 1], ["b", 2], ["", ""]])), { getterKeys: [], setterKeys: ["a", "b"] });
	assert.deepEqual(classify(bdhSet("a")), { getterKeys: [], setterKeys: ["a"] });
	assert.deepEqual(classify(bdhGet("a")), { getterKeys: ["a"], setterKeys: [] });
	assert.deepEqual(classify(bdhPop("a")), { getterKeys: ["a"], setterKeys: [] });
	assert.deepEqual(classify(bdhSetDefault("a")), { getterKeys: ["a"], setterKeys: ["a"] });
	assert.deepEqual(classify(bdhRemove("a")), { getterKeys: [], setterKeys: [] });
	assert.deepEqual(classify(bdhContains("a")), { getterKeys: [], setterKeys: [] });
});

test("classification of DictTools nodes, with key trimming", () => {
	assert.deepEqual(classify(dtExtractInt("  some_int \n")), { getterKeys: ["some_int"], setterKeys: [] });
	assert.deepEqual(classify(dtAddInt("some_int")), { getterKeys: [], setterKeys: ["some_int"] });
	assert.deepEqual(classify(dtTextToDict("\n  first \nbody\nmore body\n\n\nsecond\n\nthird\nx")), { getterKeys: [], setterKeys: ["first", "second", "third"] });
	assert.deepEqual(classify(dtLegacyExtractString("d")), { getterKeys: ["d"], setterKeys: [] });
});

test("keys from linked inputs use the upstream value, not the stale widget", () => {
	assert.deepEqual(classify(bdhGet("stale", { key: primitive("fresh") })).getterKeys, ["fresh"]);
	assert.deepEqual(classify(bdhGet("stale", { key: reroute(primitive("via_reroute")) })).getterKeys, ["via_reroute"]);
	// Unknown upstream (e.g. a non-string source): the key is skipped, not guessed.
	assert.deepEqual(classify(bdhGet("stale", { key: node({ cls: "Something", outputs: [["x", "INT"]] }) })).getterKeys, []);
});

test("unrelated nodes are ignored", () => {
	const other = node({ cls: "KSampler", inputs: [["model", "MODEL"]], outputs: [["LATENT", "LATENT"]], widgets: { seed: 1 } });
	assert.deepEqual(classify(other), { getterKeys: [], setterKeys: [] });
	assert.deepEqual(classify({}), { getterKeys: [], setterKeys: [] });
});

test("keysFromDictText", () => {
	assert.deepEqual(keysFromDictText(""), []);
	assert.deepEqual(keysFromDictText("only"), ["only"]);
	assert.deepEqual(keysFromDictText("a\n1\n\na\n2"), ["a"]);
});

test("nodeDefMentionsDict", () => {
	assert.equal(nodeDefMentionsDict({ input: { required: { input_dict: ["DICT", {}] } }, output: ["*"] }), true);
	assert.equal(nodeDefMentionsDict({ input: { optional: {} }, output: ["DICT"] }), true);
	assert.equal(nodeDefMentionsDict({ input: { required: { x: ["INT", {}] } }, output: ["INT"] }), false);
});

// A workflow: one creator sets a and b; a and b each have several getters,
// one getter of "a" lives in a subgraph, "c" has one setter and one getter.
const creator = bdhCreate([["a", 1], ["b", 2], ["", ""]]);
const getA1 = bdhGet("a");
const getA2 = dtExtractInt(" a ");
const getB1 = bdhPop("b");
const getB2 = bdhGet("x", { key: primitive("b") });
const setC = dtAddInt("c");
const getC = dtLegacyExtractString("c");
const getAinSub = bdhGet("a");
const lonelySetter = bdhSet("nobody_reads_this");
const remover = bdhRemove("a");
const subNode = node({ cls: "SubgraphNode" });
const sub = graphOf([getAinSub], { name: "Inner" });
subNode.subgraph = sub;
const root = graphOf([creator, getA1, getA2, getB1, getB2, setC, getC, lonelySetter, remover, subNode], { subgraphs: new Map([["sub-id", sub]]) });

test("counterparts are found across the root graph and subgraphs", () => {
	const found = findCounterparts(creator, "getters", root);
	assert.deepEqual(found.map((m) => [m.key, m.nodes.map((n) => n.id)]), [
		["a", [getA1.id, getA2.id, getAinSub.id]],
		["b", [getB1.id, getB2.id]],
	]);
	assert.deepEqual(findCounterparts(getAinSub, "setters", root).map((m) => m.nodes), [[creator]]);
});

test("layout: exactly one counterpart -> main item is a direct link", () => {
	const [item] = menuItemsFor(getC, root, env);
	assert.match(item.content, /^Go to DICT setter: /);
	assert.equal(item.has_submenu, undefined);
	item.callback();
	assert.equal(jumps.at(-1), setC);
});

test("layout: several counterparts, all one key -> flat list of nodes", () => {
	const item = buildMenuItem("getters", findCounterparts(bdhSet("a"), "getters", root), env);
	assert.equal(item.content, "DICT getters (3)");
	assert.deepEqual(item.submenu.options.map((o) => o.content), [getA1, getA2, getAinSub].map(env.label));
	item.submenu.options[2].callback();
	assert.equal(jumps.at(-1), getAinSub);
});

test("layout: several keys -> one entry per key, nested when a key has several nodes", () => {
	const lone = bdhGet("solo");
	const creator2 = bdhCreate([["a", 1], ["solo", 2]]);
	const g = graphOf([creator2, getA1, getA2, lone]);
	const item = buildMenuItem("getters", findCounterparts(creator2, "getters", g), env);
	assert.equal(item.content, "DICT getters (3)");
	const [aEntry, soloEntry] = item.submenu.options;
	assert.equal(aEntry.content, "a (2)");
	assert.equal(aEntry.has_submenu, true);
	assert.deepEqual(aEntry.submenu.options.map((o) => o.content), [getA1, getA2].map(env.label));
	assert.equal(soloEntry.content, `solo → ${env.label(lone)}`);
	soloEntry.callback();
	assert.equal(jumps.at(-1), lone);

	// Classic LiteGraph menu: callback gets a real event and must do nothing.
	const before = fallbacks.length;
	aEntry.callback(aEntry, {}, { type: "click" });
	assert.equal(fallbacks.length, before);
	// One-level menus (Vue node menu) call it without an event: pop up the list.
	aEntry.callback(aEntry, {}, undefined, undefined, aEntry);
	assert.equal(fallbacks.length, before + 1);
	assert.equal(fallbacks.at(-1).title, "a");
	assert.equal(fallbacks.at(-1).options.length, 2);
});

test("at most one getters item and one setters item; none when nothing matches", () => {
	const sd = bdhSetDefault("a");
	const g = graphOf([sd, creator, getA1]);
	const items = menuItemsFor(sd, g, env);
	assert.deepEqual(items.map((i) => i.content), [
		`Go to DICT getter: ${env.label(getA1)}`,
		`Go to DICT setter: ${env.label(creator)}`,
	]);
	assert.deepEqual(menuItemsFor(lonelySetter, root, env), []);
	assert.deepEqual(menuItemsFor(remover, root, env), []);
});

test("a node is never listed as its own counterpart", () => {
	const sd = bdhSetDefault("q");
	assert.deepEqual(menuItemsFor(sd, graphOf([sd]), env), []);
});
