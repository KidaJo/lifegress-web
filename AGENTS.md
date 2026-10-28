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
- Product requirements and the data model live in the private `KidaJo/personal-hq` repository (`docs/FOUNDATION.md`, `docs/DECISIONS.md`, `docs/DATA_MODEL_V1.md`). Follow them; present any conflict to the Owner.
- Preserve stable entity IDs and append-only history in any read or write path.
- Run `npm test` (Node 22+) before reporting a change as ready.
- App version format is `V<major>.<release>` with three digits each (for example `V000.018`), set in `APP_VERSION` in `app-v1.js` and shown in the footer. Major `000` means internal testing. Increment the release part by one in every publication; change the major part only on Owner instruction.
- After publishing, verify the remote commit and the GitHub Pages deployment before reporting success.
- Product UI, code and repository documentation are in English.
