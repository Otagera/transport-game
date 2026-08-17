# Transport game

A ground-up rebuild of a transport-infrastructure game. The previous build was lost before reaching a
remote — Module 0 (repo + remote from commit one) is the first priority for exactly that reason.

**Full design plan, architecture rules, and hard-won findings from the first attempt:**
[docs/rebuild-plan.md](docs/rebuild-plan.md). Read §5 (Findings) before writing simulation, economy,
pathing, or paratransit code — it's the part that cost the most to (re)learn.

As modules get built, add their own docs under `docs/` rather than growing this file.

## Delegating to OpenCode

The `opencode-delegate` skill is installed globally (`~/.agents/skills/opencode-delegate`). Use it to
offload bounded, mechanical implementation tasks (renames, boilerplate, straightforward fixes/tests)
off the orchestrating agent's own usage.

- **Default model:** `opencode/deepseek-v4-flash-free` (OpenCode Zen, confirmed `$0` cost). Use it
  unless a task needs stronger judgment.
- **Do not use other OpenCode models without asking first** — most are metered per-token and only the
  human knows which ones are pre-approved.
- **Reserve for Claude (don't delegate):** anything touching the Findings section or the Module 0–2
  build order in `docs/rebuild-plan.md`, `engine/` boundary decisions, demand/economy/growth model
  logic, or any change whose correctness rides on the reasoning already paid for in that document.
  Delegate mechanical, well-specified slices of an already-decided design, not design decisions.
- **Coordination:** sequential only, one task at a time — dispatch, review the diff, run gates, commit,
  then dispatch the next. No parallel dispatches against the same working tree.
- **Session continuity:** capture `sessionId` from `result.json` and pass it via `--session <id>` (or
  `--resume-last`) on follow-up tasks in the same thread of work, instead of starting a fresh session
  each time.
- **Commits:** the relay never commits. The orchestrator reviews the diff and commits.
