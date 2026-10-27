# V1 implementation and validation

## Owner decisions

The attached Data Model V1 and implementation handoff authorize implementation, migration, validation and publication. The owner subsequently confirmed that active Section progress excludes archived Projects. The original Foundation remains authoritative subject to these explicit amendments.

## Implementation choices

- Reuse the existing static site, credential store, GitHub transport, visual assets, responsive shell and review/publish interaction. No server, framework or paid service is added.
- Canonical Markdown has one fenced JSON block with schema 1. Containers use ordered references; entity membership uses parent_id. One normalized ephemeral map drives the UI; computed statuses are not stored.
- Current-state files load by route. History and archive are fetched on request; normal edits fetch only affected current-year history shards. Fetches coalesce and use four workers. All reads pin a commit.
- Local operations are drafts. Review builds a consistent multi-file diff from the pinned base. A later explicit Publish writes one Git tree/commit, performs a non-force ref update, then verifies every changed/deleted file. Stale base, a late ref race, or a failed verification never reports success.
- Only Task workflow status is directly editable. Empty-container rules, repeated completion and new Tasks after 100% follow V1. Unknown completion occurrence remains null. Previous dates survive reopening; a subsequent undated completion has an unknown current date while prior evidence stays in history.
- Archive/restore moves entire directories and preserves a locator with parent and ordered position. Cascade deletion also follows independently archived descendants and removes their current records/history. Prior Git commits may retain bytes.
- Existing project descriptions and confidence remain historical source context, separate from derived workflow status. Existing nested projects map to Stages without changing IDs. New Stage breakdowns are not invented.

## Migration safeguards

The script accepts a source and a new output directory, refuses overwrite or a second migration, preserves source hashes and task evidence, and emits a stable-ID mapping. Original source files become locators. Existing table and multiline web events retain IDs and timestamps in scoped shards. Original files are untouched by the script. Publication must use a freshly verified remote snapshot, not the earlier offline trial.

## Validation limits

Automated tests cover model rules, archive/restore/delete, migration, conflict/race handling, read-back and cold/warm request counts. Local transport benchmarks measure parsing and app computation; they are not GitHub network latency. Physical iOS and an authenticated live V1 write require final validation after publication. Synthetic QA uses no private projects or credentials.

## Verification — 2026-10-27

30 automated tests pass. Synthetic 390px browser verification: title and partial-date fields all measure 335px, with content scrollWidth equal to clientWidth (375px). Physical iOS Safari remains unverified. Local mocked-transport benchmark: 11 initial index/Section requests, 21 additional active-data requests, one warm head check; no history or archive reads. These are request counts, not production network latency.
