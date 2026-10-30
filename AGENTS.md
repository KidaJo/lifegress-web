# Lifegress Web agent instructions

## Authority and roles

- The user is the Owner and final authority.
- ChatGPT supports the Owner with product direction, requirements, UX and implementation planning.
- Claude Code and Codex are interchangeable development agents. Either may implement, review, or publish an Owner-approved change.
- For each version, the Owner chooses one mode:
  - Implement + review: one agent implements and the other reviews; either publishes after Owner approval.
  - Implement only: one agent implements and publishes after Owner approval; cross-agent review is skipped.
- Prefer one agent per version. If work is handed over mid-version, the outgoing agent records a checkpoint (changes, tests, open risks) and the incoming agent verifies the actual repository state before continuing.
- Never modify the same working tree concurrently with another agent.
- Never push or deploy without explicit Owner approval of the specific change. The implementing agent reports changes, tests and risks before publication.
- Roles do not grant credentials. Verify access before planning a release.

## Repository rules

- This repository is public. Never commit personal data, private Markdown records, tokens or credentials. Use synthetic fixtures in tests.
- Product requirements and the data model live in the private `KidaJo/lifegress-hq` repository (`docs/FOUNDATION.md`, `docs/DECISIONS.md`, `docs/DATA_MODEL_V1.md`). Follow them; present any conflict to the Owner.
- Preserve stable entity IDs and append-only history in any read or write path.
- Run `npm test` (Node 22+) before reporting a change as ready.
- `scripts/check-data.mjs` (validator) and `scripts/lifegress.mjs` (agent writer) are used by the private data repository and its Check data workflow. Keep their command-line interface backward compatible, and keep them working with only `data-v1.mjs` and Node built-ins.
- App version format is `V<major>.<release>` with three digits each (for example `V000.018`), set in `APP_VERSION` in `app-v1.js` and shown in the footer. Major `000` means internal testing. Increment the release part by one in every publication; change the major part only on Owner instruction.
- Before every push or publication, update two records in the same step and include them in the report to the Owner: (1) the Lifegress project (`SYS-001`) in the data repository through `scripts/lifegress.mjs`, for example a Completed "Release V000.0xx: …" task; (2) the Owner's folder guide `../../README.md` (outside the repositories, in Traditional Chinese) and its update log, whenever folders, workflow, rules or in-progress work change.
- After publishing, verify the remote commit and the GitHub Pages deployment before reporting success.
- Product UI, code and repository documentation are in English.
