// DICT Key Navigator: core logic.
//
// This file deliberately imports nothing from ComfyUI, so it can be unit-tested
// outside the browser. ComfyUI loads every .js file in a pack's web directory;
// this one only defines exports and has no side effects.
//
// Vocabulary:
//   setter: a node that puts a value into a DICT under some key(s).
//   getter: a node that reads a value out of a DICT by key.
// A node can be both (e.g. basic_data_handling's "setdefault").

/** The socket type name both basic_data_handling and DictTools use. */
export const DICT_TYPE = "DICT";

// Widget/input names that hold a key. "key" (single-key nodes in both packs)
// and "key_0", "key_1", ... (basic_data_handling's dynamic "create" nodes).
const KEY_NAME = /^key(_\d+)?$/;
// Names of the value going *into* a setter.
const VALUE_IN_NAME = /^value(_\d+)?$/;
// Name of the value coming *out of* a getter.
const VALUE_OUT_NAME = /^value$/;

/** Legacy "Reroute" nodes pass a link straight through; follow them. */
const PASS_THROUGH_TYPES = new Set(["Reroute"]);

// ---------------------------------------------------------------------------
// Small helpers that tolerate differences between frontend versions.

export function nodeClass(node) {
	return node?.comfyClass ?? node?.type ?? "";
}

function isDictType(type) {
	if (typeof type !== "string") return false;
	// Multi-type sockets are written "A,B" in ComfyUI.
	return type.split(",").some((t) => t.trim() === DICT_TYPE);
}

function inputsOf(node) {
	return Array.isArray(node?.inputs) ? node.inputs : [];
}
function outputsOf(node) {
	return Array.isArray(node?.outputs) ? node.outputs : [];
}
function widgetsOf(node) {
	return Array.isArray(node?.widgets) ? node.widgets : [];
}
function nodesOf(graph) {
	const nodes = graph?.nodes ?? graph?._nodes;
	return Array.isArray(nodes) ? nodes : [];
}

/** Keys are compared after trimming whitespace; empty keys are ignored. */
export function normalizeKey(value) {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string" && typeof value !== "number") return null;
	const key = String(value).trim();
	return key === "" ? null : key;
}

// ---------------------------------------------------------------------------
// Reading key values.

/**
 * Best-effort value of whatever feeds a linked input: follows legacy Reroute
 * nodes, then takes the first string widget on the source node (a primitive,
 * a string node, ...). Returns undefined when it can't tell.
 */
function upstreamStringValue(node, slotIndex) {
	if (typeof node.getInputNode !== "function") return undefined;
	let source = node.getInputNode(slotIndex);
	for (let hops = 0; source && hops < 32 && PASS_THROUGH_TYPES.has(nodeClass(source)); hops++) {
		source = typeof source.getInputNode === "function" ? source.getInputNode(0) : null;
	}
	if (!source) return undefined;
	const widget = widgetsOf(source).find((w) => typeof w?.value === "string");
	return widget ? widget.value : undefined;
}

/**
 * The value of the key-holding widget/input called `name` on `node`.
 * If that input is connected to a link, the widget's own value is stale, so
 * the upstream value is used instead (or nothing, if it can't be determined).
 */
export function readNamedValue(node, name) {
	const inputs = inputsOf(node);
	const slotIndex = inputs.findIndex((inp) => inp && (inp.widget?.name === name || inp.name === name));
	if (slotIndex !== -1 && inputs[slotIndex].link != null) {
		return upstreamStringValue(node, slotIndex);
	}
	const widget = widgetsOf(node).find((w) => w?.name === name);
	return widget ? widget.value : undefined;
}

/** All names on the node (widgets and input sockets) that match `pattern`. */
function namesMatching(node, pattern) {
	const names = new Set();
	for (const w of widgetsOf(node)) if (typeof w?.name === "string" && pattern.test(w.name)) names.add(w.name);
	for (const inp of inputsOf(node)) {
		const n = inp?.widget?.name ?? inp?.name;
		if (typeof n === "string" && pattern.test(n)) names.add(n);
	}
	return [...names];
}

function keysFromNames(node, names) {
	const keys = [];
	for (const name of names) {
		const key = normalizeKey(readNamedValue(node, name));
		if (key !== null && !keys.includes(key)) keys.push(key);
	}
	return keys;
}

/**
 * Keys defined by DictTools' "Dict from Text" node: the text is split into
 * blocks separated by blank lines, and the first line of each block is a key.
 */
export function keysFromDictText(text) {
	if (typeof text !== "string") return [];
	const keys = [];
	let inBlock = false;
	for (const line of text.split(/\r\n|\r|\n/)) {
		if (line.trim() === "") {
			inBlock = false;
			continue;
		}
		if (!inBlock) {
			const key = normalizeKey(line);
			if (key !== null && !keys.includes(key)) keys.push(key);
			inBlock = true;
		}
	}
	return keys;
}

// ---------------------------------------------------------------------------
// Classification.
//
// A few known nodes get explicit rules. Everything else goes through a
// generic, name-based rule, which is what keeps this working when either pack
// adds or renames nodes (and lets you write your own compatible nodes):
//
//   setter: has a DICT output, a key widget/input ("key" or "key_<n>"),
//           and a value input ("value" or "value_<n>").
//   getter: has a DICT input, a key widget/input, and an output named "value".
//
// Node class names are only used for the special cases below, and those are
// matched loosely so small renames don't break them.

const EMPTY = Object.freeze({ getterKeys: [], setterKeys: [] });

/** @type {{ test: (cls: string) => boolean, classify: (node: any) => {getterKeys: string[], setterKeys: string[]} }[]} */
export const SPECIAL_RULES = [
	{
		// DictTools "Dict from Text" (and its older IDs): keys live in a text block.
		test: (cls) => /TextToDict|DictFromText/.test(cls),
		classify: (node) => {
			const name = ["dict_text", "strings"].find((n) => readNamedValue(node, n) !== undefined);
			return { getterKeys: [], setterKeys: name ? keysFromDictText(readNamedValue(node, name)) : [] };
		},
	},
	{
		// Old DictTools node IDs from the String Constructor pack used "name" for the key.
		test: (cls) => /^StringConstructorDictAdd/.test(cls),
		classify: (node) => ({ getterKeys: [], setterKeys: keysFromNames(node, ["name"]) }),
	},
	{
		test: (cls) => /^StringConstructorDictExtract/.test(cls),
		classify: (node) => ({ getterKeys: keysFromNames(node, ["name"]), setterKeys: [] }),
	},
	{
		// setdefault reads the key and also writes it when it's missing.
		test: (cls) => /DictSetDefault/.test(cls),
		classify: (node) => {
			const keys = keysFromNames(node, namesMatching(node, KEY_NAME));
			return { getterKeys: keys, setterKeys: [...keys] };
		},
	},
];

function classifyGeneric(node) {
	const hasDictIn = inputsOf(node).some((i) => isDictType(i?.type));
	const hasDictOut = outputsOf(node).some((o) => isDictType(o?.type));
	if (!hasDictIn && !hasDictOut) return EMPTY;

	const isGetter = hasDictIn && outputsOf(node).some((o) => !isDictType(o?.type) && VALUE_OUT_NAME.test(o?.name ?? ""));
	const isSetter = hasDictOut && namesMatching(node, VALUE_IN_NAME).length > 0;
	if (!isGetter && !isSetter) return EMPTY;

	const keys = keysFromNames(node, namesMatching(node, KEY_NAME));
	return {
		getterKeys: isGetter ? keys : [],
		setterKeys: isSetter ? [...keys] : [],
	};
}

/** Which keys `node` gets and which it sets. Never throws. */
export function classify(node) {
	try {
		const cls = nodeClass(node);
		const rule = SPECIAL_RULES.find((r) => r.test(cls));
		return rule ? rule.classify(node) : classifyGeneric(node);
	} catch (err) {
		console.warn("[DICT Key Navigator] could not inspect node", node?.id, err);
		return EMPTY;
	}
}

// ---------------------------------------------------------------------------
// Finding counterparts.

/** The root graph plus every subgraph, each once. */
export function allGraphs(rootGraph) {
	const graphs = [];
	const seen = new Set();
	const visit = (g) => {
		if (!g || seen.has(g)) return;
		seen.add(g);
		graphs.push(g);
		for (const n of nodesOf(g)) if (n?.subgraph) visit(n.subgraph);
	};
	visit(rootGraph);
	// Subgraph definitions are also registered on the root graph; include them
	// even if no node currently instantiates them.
	const defs = rootGraph?.subgraphs;
	if (defs && typeof defs.values === "function") for (const g of defs.values()) visit(g);
	return graphs;
}

/**
 * Nodes on the other side of `node` for the given direction.
 * direction "getters": node's set keys -> nodes that get those keys.
 * direction "setters": node's get keys -> nodes that set those keys.
 * Returns [{ key, nodes }] in the order the keys appear on `node`.
 */
export function findCounterparts(node, direction, rootGraph) {
	const mine = classify(node);
	const myKeys = direction === "getters" ? mine.setterKeys : mine.getterKeys;
	if (myKeys.length === 0) return [];

	const byKey = new Map(myKeys.map((k) => [k, []]));
	for (const graph of allGraphs(rootGraph)) {
		for (const other of nodesOf(graph)) {
			if (!other || other === node) continue;
			const info = classify(other);
			const theirKeys = direction === "getters" ? info.getterKeys : info.setterKeys;
			for (const k of theirKeys) byKey.get(k)?.push(other);
		}
	}
	return [...byKey]
		.filter(([, nodes]) => nodes.length > 0)
		.map(([key, nodes]) => ({ key, nodes }));
}

// ---------------------------------------------------------------------------
// Menu building (follows the layout rules in README.md).

/**
 * @param {"getters"|"setters"} direction
 * @param {{key: string, nodes: any[]}[]} matches from findCounterparts
 * @param {{ label: (node) => string, jump: (node) => void, openFallback: (options, title) => void }} env
 * @returns a LiteGraph context-menu item, or null when there is nothing to offer
 */
export function buildMenuItem(direction, matches, env) {
	const noun = direction === "getters" ? "getter" : "setter";
	const distinct = [];
	for (const m of matches) for (const n of m.nodes) if (!distinct.includes(n)) distinct.push(n);
	if (distinct.length === 0) return null;

	const link = (content, target) => ({ content, callback: () => env.jump(target) });

	// One counterpart in total: the main item jumps straight to it.
	if (distinct.length === 1) {
		return link(`Go to DICT ${noun}: ${env.label(distinct[0])}`, distinct[0]);
	}

	const title = `DICT ${noun}s`;
	let options;
	if (matches.length === 1) {
		// Everything is about one key: list the nodes directly.
		options = matches[0].nodes.map((n) => link(env.label(n), n));
	} else {
		// One entry per key.
		options = matches.map(({ key, nodes }) => {
			if (nodes.length === 1) return link(`${key} → ${env.label(nodes[0])}`, nodes[0]);
			const inner = nodes.map((n) => link(env.label(n), n));
			return {
				content: `${key} (${nodes.length})`,
				has_submenu: true,
				submenu: { title: key, options: inner },
				// The classic LiteGraph menu opens `submenu` itself and passes a
				// real event here, so this does nothing there. Menus that only
				// support one submenu level (the newer Vue node menu) call this
				// without an event instead; then pop the list up separately.
				callback: (_value, _options, event) => {
					if (event === undefined) env.openFallback(inner, key);
				},
			};
		});
	}
	return {
		content: `${title} (${distinct.length})`,
		has_submenu: true,
		submenu: { title, options },
	};
}

/** All menu items (0, 1 or 2) this pack adds for `node`. */
export function menuItemsFor(node, rootGraph, env) {
	const items = [];
	for (const direction of ["getters", "setters"]) {
		const item = buildMenuItem(direction, findCounterparts(node, direction, rootGraph), env);
		if (item) items.push(item);
	}
	return items;
}

/** Whether a node definition (from /object_info) involves DICT at all. */
export function nodeDefMentionsDict(nodeData) {
	if (!nodeData) return false;
	const outputs = Array.isArray(nodeData.output) ? nodeData.output : [];
	if (outputs.some(isDictType)) return true;
	for (const group of ["required", "optional"]) {
		const inputs = nodeData.input?.[group];
		if (!inputs) continue;
		for (const spec of Object.values(inputs)) if (Array.isArray(spec) && isDictType(spec[0])) return true;
	}
	return false;
}
