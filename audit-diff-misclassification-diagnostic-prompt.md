# Diagnostic Prompt: "Changed" Items Misclassified as "Added" in Audit List

**Read-only investigation. No code changes. No fixes proposed until findings are reported and reviewed.**

## Symptom
The Audit Modifications sidebar list shows items that were actually modified (moved, re-routed, rotated, etc. — same component/net/track present in both base and target commits, just with different geometry) as **"Added"** instead of **"Changed."** This implies the diff engine is failing to recognize that a base-commit element and a target-commit element are "the same thing," and is instead treating them as two unrelated items — one that disappeared (should surface as "Deleted" but may not be, see below) and one that newly appeared (surfaces as "Added").

## Hypothesis (to be confirmed or refuted, not assumed)
The diff engine likely performs **identity matching** — deciding whether a base-commit item and a target-commit item are the same real-world component/track/pad — using some key (UUID, net+layer+approximate-position, geometry hash, etc.). If that key is unstable between the base and target versions of a genuinely modified item (e.g. a UUID that regenerates on save, or a position-based key that shifts too far once the item moves), the matcher will fail to pair them, and whatever fallback logic exists for "unmatched base item" / "unmatched target item" will misclassify a real modification as a delete+add pair, or in this case, apparently only surfaces the "add" half.

This is a hypothesis only. Confirm the actual mechanism against the real code before proposing any fix.

---

## Investigation Steps (cite every answer with file + line + literal excerpt)

### 1. Locate the classification logic
Find the exact function(s) in `svg-diff-processor.js` (and any other file it delegates to) that assign the `type` field (`"added"` / `"deleted"` / `"modified"` / `"changed"` — confirm the exact literal string values used) to each entry in the modifications array that ultimately populates the Audit Modifications sidebar.

### 2. Identify the matching key
For each element category the diff engine handles (tracks, vias, footprints/pads, zones, graphics):
- What key is used to decide "this base-commit item and this target-commit item are the same real thing"? (UUID? net name + layer? geometric proximity/hash? array index? something else?)
- Paste the literal matching code — the actual comparison or lookup, not a paraphrase.

### 3. Reproduce the specific failure
Using the two commits/board states that produced the screenshot showing `SPI2_CS` mis-rendered as "Added" (or any other reproducible modified-but-shown-as-added case), extract the raw base-commit and target-commit data for that specific element (from the SVG or, better, from `parseKiCadBoard()` output if the diff engine has been updated to use it — confirm which data source the diff engine actually reads from; it may still be doing pure SVG-geometry diffing rather than using the new parser at all, which is itself worth confirming since this changes where the fix belongs entirely).
- Does the matching key computed for the base version equal the matching key computed for the target version for this specific element?
- If not, show both literal key values side by side and explain why they differ.

### 4. Check the fallback/bucketing logic
Once matching fails (or "succeeds" incorrectly) for an item, trace exactly what code path assigns it to the `added` bucket versus `deleted` versus `modified`. Is there a two-pass process (unmatched-in-base → deleted, unmatched-in-target → added, matched-but-different → modified)? If so, is the "deleted" counterpart for this same failed match actually being generated too (just not shown/reported to you), or is it being dropped entirely somewhere? This determines whether the bug is purely a classification/labeling issue or whether data is being silently lost.

### 5. Confirm what data source the diff engine is actually using
Given the project now has a verified `.kicad_pcb` structural parser (`kicad-pcb-parser.js`) with stable `uuid`/`tstamp` fields per Section 2 of `context.md` — is the diff engine (`svg-diff-processor.js`) using that parser's output for matching at all, or is it still diffing raw SVG geometry/attributes (which, per earlier verification in this project, carry no stable per-element identity — no `class`, no `id`, only geometry)? If it's still SVG-based, that alone would fully explain unstable matching on any modified item, since there is no persistent identity to match against, only geometry that changes precisely because the item moved. This may be the actual root cause, not a bug in the matching logic itself but a data-source problem — the diff engine may need to be migrated to match on the parser's `uuid`/`tstamp` fields instead of geometric similarity.

---

## Required Output
A findings report (not a fix) containing:
1. The exact classification code path, cited.
2. The exact matching key(s) currently in use, per element type, cited.
3. Literal before/after key values for the specific reproduced failure case in step 3.
4. A definitive answer to step 5 — parser-based or SVG-geometry-based matching — since this determines the entire shape of the correct fix.
5. Explicit confirmation of whether the "deleted" counterpart of a misclassified "added" item is present-but-unreported, or genuinely missing from the output — do not guess, trace the actual data.

Do not propose or implement a fix in this pass. Report findings only.
