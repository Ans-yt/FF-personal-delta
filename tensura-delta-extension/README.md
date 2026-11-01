# Tensura — Saved State Delta

A SillyTavern frontend extension for the Tensura FF5 delta preset. The model writes only changes for Status, GM Notebook and factions. This extension replaces those commands in the **actual saved assistant message** with the full reconstructed trackers, saves through SillyTavern, and refreshes the message display.

No build step, Node installation, API key, server plugin or runtime package download is required for use. Existing FF5/Tensura display and context-saving Regex remain responsible for presentation and context filtering. This extension does not change the preset, Regex, enabled flags, reasoning prompts, character, or other internal modules. There is no new Status/Appraisal/Analysis UI in this release.

## Put this on GitHub

1. Create a GitHub repository (a public repository is easiest for installation).
2. Upload **the contents of this folder** to the repository root. `manifest.json` and `index.js` must be at the root, rather than inside a second `tensura-delta` folder. Include `engine.js` and `runtime.js` alongside them. You can include all the supplied files, including tests.
3. In SillyTavern, open **Extensions → Install extension** and paste your repository URL, such as `https://github.com/YOUR-NAME/tensura-delta`.
4. Reload SillyTavern. The browser console should show `Tensura Delta 1.0.0 loaded` (with brackets around the name).
5. Select the supplied `Tensura freaky frankenstein-5.4-final-delta.json` preset. Keep your existing embedded Regex enabled. No changes to those Regex are needed.

Use a copy/branch of your RP chat for the first live check. Generate a response, open its message editor, and verify it contains a full `<ts>` and the reconstructed notes/factions, rather than a `<delta>`. This confirms that the saved text, not just its display, has changed. This release was verified against SillyTavern's current public `release` APIs on 2026-11-01, but has not been run in your live SillyTavern installation.

## Commands

- `/td-repair` processes a complete delta in the latest assistant message. Add a zero-based message index to target another message: `/td-repair 12`.
- `/td-restore` restores the original model text for that exact processed message/selected swipe. An index is also accepted. It refuses if you subsequently edited the reconstructed text. After restoring, fix the delta and use `/td-repair`, or save the edited message to run the normal handler.

Recovery deliberately leaves the delta unresolved until repaired. Do not generate the next turn while a previous delta is unresolved. The original input and reconstructed output are kept in the message's `extra.tensura_saved_delta_v1` metadata, and in selected-swipe metadata when available. These backups are not sent as ordinary message text. This is a local safety copy, not an unlimited version history; export important chats normally.

## Delta format

One JSON array per line inside one `<delta>`, nested inside the complete generated `<internal_states>`. No outer JSON array or Markdown code fence. Examples below illustrate syntax only; they do not establish character facts.

```text
<delta>
["v","1.15M/1.15M","1.72M"]
["q","orb_01",-1]
["s","eqp_01","Properties","Existing properties plus confirmed change"]
["m","eqp_02","so"]
["a","ss","skl_18",{"Name":"Flame Resistance","Type":"Extra Skill","Skill effect":"Reduces fire damage"}]
["d","ttl_03"]
</delta>
```

| Operation | Meaning |
|---|---|
| `["v",magicules,EP]` | Absolute values, both strings; required when Status already exists. Preserves independent EP and established current/max notation. |
| `["a",destination,id,{fields}]` | Add a complete new record. Never overwrite/reuse an existing or retired ID. |
| `["s",id,field,value]` | Edit one field; `null` removes an optional field. IDs cannot be edited. Body uses `["s","body","Name","description"]`. |
| `["q",id,signedChange]` | Add/subtract quantity. Zero deletes the item; negative resulting quantities fail. |
| `["m",id,destination]` | Move **one unit**, preserving details. For a stack, keep the source ID and derive `source_split1` (or the next unused suffix) for the moved unit. |
| `["d",id]` | Delete the identified record. |

Destinations: `sw`, `so`, `ss`, `st`, `sc`, `sd`, `si/Materials`, `si/Objects`, `si/Skill orbs`, `si/Equipment`, `gm`, `fac`. Body is the singleton `body`, edited with `s`.

Fields: `Name`, `Quantity`, `Type`, `Class`, `Grade`, `Slot`, `Properties`, `Composition`, `Uses`, `Orb skill/effect`, `Skill effect`; factions also use `Goal`, `Intel`, `Fibs`, `State`, `Conflict`, `Relations`. GM notes use `Type` (`R`, `T`, `D`) and `Text`.

Moving gear does not guess which occupied slot to clear. Include an explicit move returning replaced gear to storage. Consuming an orb does not invent its skill: include the confirmed skill addition when necessary. The extension validates transactions and quantities, not Tensura lore or narrative causality. For GM Notebook's 20-entry limit, include explicit deletes for pruned entries; the extension will not silently drop reminders.

## Preservation and IDs

- Start with your actual latest tagged `<ts>` snapshot. Unchanged body, rows, equipment, skills, inventory, titles, full GM Notebook and faction blocks are copied from that snapshot verbatim. Field edits preserve other established field text. New/changed text is XML-escaped once; put ordinary text in JSON values, not pre-escaped HTML entities.
- Existing IDs are retained. Unnumbered legacy rows receive deterministic destination/order IDs. An HTML comment `<!-- TD_IDS {...} -->` in the reconstructed snapshot maps stable IDs to destination and row index, including retired IDs. This lets the model address records that originally lacked IDs **without rewriting their original descriptions**. It is part of the saved context; do not remove it when editing snapshots. First-turn numbering follows `skl_01`, `gm_01`, `fac_01`, etc.; existing IDs are reserved first.
- The current compact XML-like tagged Status is supported. Older JSON-inside-`<ts>` snapshots are explicitly rejected rather than guessed or converted with possible data loss. Convert such a legacy snapshot to your preset's current tagged format before using delta mode.
- New chats only acquire facts supplied in their deltas; no sample character, skills, inventory or resources are seeded. Unknown stays Unknown.
- Dynamic sections (NPC agendas, locations, thoughts, DnD, physics and any other untouched modules) remain the model's freshly generated text. The extension only reconstructs the three static trackers.

## Branches, swipes, generation and edits

- The baseline is the nearest preceding assistant snapshot in the **currently open chat and selected swipes**. There is no shared character-state cache or browser storage to leak facts between branches.
- Only the selected swipe is updated. Other swipes retain their own text; a complete raw delta in another swipe is processed when selected. Swipe-specific backups are kept separately.
- Regeneration starts from the preceding message, not the discarded answer's state.
- A continuation can complete an unfinished delta, or append a new complete Internal States block after an existing full snapshot. The latter merges from the inline snapshot, removes superseded Internal States blocks and their paired GFX markers, and preserves narrative outside those blocks. Multiple delta blocks or a delta outside a complete Internal States block are rejected.
- Duplicate lifecycle events do not repeat quantity changes: successful replacement removes the delta. A deliberate edit reintroducing a delta is a new update. Manual edits to already reconstructed full snapshots are respected. Existing later full snapshots are historical records; changing an earlier message does **not** silently recalculate descendants. Regenerate from that point if you want a changed timeline.
- Chat loading alone never rewrites your history. `/td-repair` handles an old unresolved delta explicitly.
- Malformed JSON, unknown IDs, invalid destinations, duplicate IDs, missing current values, negative quantities and incomplete blocks leave the original message unchanged. No partial transaction is committed. Error details appear in a toast and console.

## API and persistence notes

Primary hooks: `MESSAGE_RECEIVED` (streaming and non-streaming), `MESSAGE_EDITED`, `MESSAGE_UPDATED`, and `MESSAGE_SWIPED`. `GENERATION_ENDED` provides a fallback; its argument is chat length, so it is not treated as a message ID. The extension modifies `getContext().chat`, synchronizes the selected `swipes` entry, calls `updateMessageBlock`, and uses `saveChat()`.

SillyTavern's current `saveChat()` implementation logs some server failures rather than throwing them; this extension cannot promise a disk-write receipt beyond that API. Normal SillyTavern persistence and connection failures still apply. A complete delta can be processed after a stopped generation; an incomplete one is preserved for continuation/repair. No prompts are intercepted and no earlier snapshots are injected into model context.

Verified references:

- [Official UI extension documentation](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [Current context API](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js)
- [Current lifecycle event names](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/events.js)
- [Generation, rendering and save implementation](https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js)

## Developer checks

With a recent Node.js version, run `npm test` from this folder. No dependency installation is required. Tests cover preservation, field patches, moves/splits, quantity validation, IDs/retirement, escaping, notebook limits, duplicate events, swipes, branches, regeneration, continuations, edits, recovery and mocked lifecycle/save/render integration. A real SillyTavern/browser smoke test remains necessary for your installed version and other extensions.
