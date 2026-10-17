// DICT Key Navigator: ComfyUI frontend extension.
//
// Adds "DICT getters" / "DICT setters" items to node context menus so you can
// jump between nodes that set a DICT key and nodes that get the same key.
//
// Interference policy: this extension never replaces or wraps global
// LiteGraph/ComfyUI functions. On current frontends it only uses the official
// getNodeMenuItems hook. On older frontends without that hook it chains onto
// getExtraMenuOptions, and only for node types that have a DICT socket.

import { app } from "../../scripts/app.js";
import { menuItemsFor, nodeClass, nodeDefMentionsDict } from "./dict_key_nav_core.js";

const EXTENSION_NAME = "DictKeyNav.Navigation";

function rootGraph() {
	return app.rootGraph ?? app.graph;
}

function label(node) {
	const title = node.title || nodeClass(node) || "node";
	let text = `${title} #${node.id}`;
	const graph = node.graph;
	if (graph && graph !== rootGraph()) text += ` (in ${graph.name || "subgraph"})`;
	return text;
}

function nextFrame() {
	return new Promise((resolve) => {
		const timeout = setTimeout(resolve, 100); // rAF stalls in background tabs
		requestAnimationFrame(() => {
			clearTimeout(timeout);
			resolve();
		});
	});
}

async function jump(target) {
	try {
		const canvas = app.canvas;
		const graph = target?.graph;
		if (!canvas || !graph) return;

		// Enter (or leave) a subgraph if needed. The frontend's breadcrumb and
		// URL state follow the canvas's current graph on their own.
		if (canvas.graph !== graph && typeof canvas.setGraph === "function") {
			canvas.setGraph(graph);
			await nextFrame();
			await nextFrame();
		}
		if (canvas.graph !== graph) return;

		if (typeof canvas.selectNode === "function") canvas.selectNode(target, false);
		if (typeof canvas.animateToBounds === "function" && target.boundingRect) {
			canvas.animateToBounds(target.boundingRect);
		} else if (typeof canvas.centerOnNode === "function") {
			canvas.centerOnNode(target);
		}
		canvas.setDirty?.(true, true);
	} catch (err) {
		console.warn("[DICT Key Navigator] could not jump to node", target?.id, err);
	}
}

// Where the pointer last went down/up, for placing the fallback pop-up menu.
const lastPointer = { x: 0, y: 0 };
function rememberPointer(e) {
	lastPointer.x = e.clientX;
	lastPointer.y = e.clientY;
}

/** Shows a plain LiteGraph menu at the pointer (used when nested submenus aren't supported). */
function openFallback(options, title) {
	const ContextMenu = window.LiteGraph?.ContextMenu;
	if (typeof ContextMenu !== "function") {
		options[0]?.callback?.();
		return;
	}
	// Defer so the menu that was just clicked finishes closing first.
	setTimeout(() => {
		try {
			const event = new MouseEvent("click", { clientX: lastPointer.x, clientY: lastPointer.y });
			new ContextMenu(options, { event, title });
		} catch (err) {
			console.warn("[DICT Key Navigator] could not open menu", err);
		}
	}, 0);
}

const env = { label, jump, openFallback };

function itemsFor(node) {
	try {
		return node ? menuItemsFor(node, rootGraph(), env) : [];
	} catch (err) {
		console.warn("[DICT Key Navigator] could not build menu", err);
		return [];
	}
}

const extension = {
	name: EXTENSION_NAME,
	setup() {
		const opts = { capture: true, passive: true };
		document.addEventListener("pointerdown", rememberPointer, opts);
		document.addEventListener("pointerup", rememberPointer, opts);
	},
};

if (typeof app.collectNodeMenuItems === "function") {
	// Current frontends: the official hook, used by both the classic
	// right-click menu and the newer node "more options" menu.
	extension.getNodeMenuItems = itemsFor;
} else {
	// Older frontends: chain onto getExtraMenuOptions for DICT node types only.
	extension.beforeRegisterNodeDef = (nodeType, nodeData) => {
		if (!nodeDefMentionsDict(nodeData)) return;
		const previous = nodeType.prototype.getExtraMenuOptions;
		nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
			const result = previous?.apply(this, arguments);
			const items = itemsFor(this);
			if (items.length && Array.isArray(options)) options.push(...items);
			return result;
		};
	};
}

app.registerExtension(extension);
