# DICT Key Navigator for ComfyUI

Right-click a node that **sets** a DICT key to jump to every node that **gets**
that key, and the other way round. It works with the DICT nodes in
[Basic data handling](https://github.com/StableLlama/ComfyUI-basic_data_handling)
and [Dict Tools](https://github.com/Lex-DRL/ComfyUI-DictTools), across subgraphs.

Matching is by key name only: it does not care which DICT a node reads or
writes. Keys are compared after trimming surrounding whitespace.

This pack adds no nodes; it is a frontend extension only.

## Installing

Put this folder in `ComfyUI/custom_nodes/` and restart ComfyUI, then reload the
browser tab.

## The menu

On a node, this pack adds at most one getters item and one setters item:

- **One counterpart in total:** a single item, `Go to DICT getter: <node>`,
  that jumps straight there.
- **Several, all for the same key:** `DICT getters (n)` opens a list of them.
- **Several keys:** `DICT getters (n)` opens one entry per key. A key with one
  getter is a direct link (`key → <node>`); a key with several opens a further
  submenu listing them.

Nodes inside a subgraph are labelled `(in <subgraph name>)`; jumping to one
opens that subgraph first. Jumping selects the node and centres the view on it.

ComfyUI's newer node menu (the one in "Vue nodes" mode) only supports one
level of submenu. There, choosing a key that has several nodes pops up a small
separate menu with those nodes at the pointer.

## Which nodes count as getters and setters

Most nodes are recognised by a naming rule, so new nodes in either pack (or
your own) work automatically if they follow it:

| Role   | Needs                                                                                     |
|--------|-------------------------------------------------------------------------------------------|
| setter | a `DICT` output, a key widget/input named `key` or `key_<n>`, and an input named `value` or `value_<n>` |
| getter | a `DICT` input, a key widget/input named `key` or `key_<n>`, and an output named `value`   |

A few nodes have explicit rules in `web/dict_key_nav_core.js` (`SPECIAL_RULES`):

- Dict Tools **Dict from Text**: the first line of each blank-line-separated block is a key (setter).
- Basic data handling **setdefault**: both a getter and a setter.
- Dict Tools' old node IDs from the String Constructor pack, which used `name` for the key.

What that means for specific nodes:

- **Setters:** create DICT (all variants), set, setdefault; Dict Tools' "Dict ← …" add nodes and Dict from Text.
- **Getters:** get, pop, setdefault; Dict Tools' "Dict → …" extract nodes.
- **Neither:** remove, contains key, get multiple, filter/exclude keys, from keys, create from lists/items/JSON, merge, update. These either don't read or write a single value, or take their keys from a LIST rather than a widget.

If a key widget is connected to another node, the key is read from that node's
first text widget (through legacy Reroute nodes too). If that can't be
determined, for example because the key comes from a computed string or a
subgraph input, the key is skipped rather than guessed.

## Compatibility

- On current ComfyUI frontends it uses only the official `getNodeMenuItems`
  extension hook, which feeds both the classic and the newer node menus. It
  does not patch any LiteGraph or ComfyUI functions.
- On older frontends without that hook, it chains onto `getExtraMenuOptions`,
  only for node types that have a `DICT` socket, and always calls whatever was
  there before.
- It never throws into ComfyUI: any error inspecting a node is logged to the
  browser console and that node is skipped.

## Tests

The classification and menu logic lives in `web/dict_key_nav_core.js`, which
has no ComfyUI imports. With Node.js 18+: `npm test`.
