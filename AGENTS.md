# Transport game

A transport-infrastructure game. The original module build order (0 through 12) is complete —
see [docs/status.md](docs/status.md) for current state.

**Read [docs/status.md](docs/status.md) first** to see where things stand, then
**[docs/brief.md](docs/brief.md)**: the design contract for what the game is and what gets built
next. A new system, verb or screen element must point at a line in it; delegated work names the
section it implements. Then:

- [docs/principles.md](docs/principles.md) — design premise, scope, and §3 (Findings), the
  hard-won lessons from building this twice. **Read Findings before writing simulation, economy,
  pathing, paratransit, or growth code** — it's the part that cost the most to (re)learn.
- [docs/architecture/index.md](docs/architecture/index.md) — hard rules, directory map, the tick
  loop, build/verify pipeline — then follow into `engine.md` / `render-and-ui.md` / `content.md` /
  `dev-studio.md` for the subsystem you're touching.

As new work gets built, update status.md and the relevant architecture deep-dive rather than
growing this file.

## Delegating to OpenCode

The `opencode-delegate` skill is installed globally (`~/.agents/skills/opencode-delegate`). Use it to
offload bounded, mechanical implementation tasks (renames, boilerplate, straightforward fixes/tests)
off the orchestrating agent's own usage.

- **Default model:** `opencode/deepseek-v4.1-flash-free` (OpenCode Zen, confirmed `$0` cost). Use it
  unless a task needs stronger judgment.
- **Do not use other OpenCode models without asking first** — most are metered per-token and only the
  human knows which ones are pre-approved.
- **Reserve for Claude (don't delegate):** anything touching `docs/principles.md` §3 (Findings),
  `engine/` boundary decisions, demand/economy/growth model logic, or any change whose correctness
  rides on the reasoning already paid for in that document.
  Delegate mechanical, well-specified slices of an already-decided design, not design decisions.
- **Coordination:** sequential only, one task at a time — dispatch, review the diff, run gates, commit,
  then dispatch the next. No parallel dispatches against the same working tree.
- **Session continuity:** capture `sessionId` from `result.json` and pass it via `--session <id>` (or
  `--resume-last`) on follow-up tasks in the same thread of work, instead of starting a fresh session
  each time.
- **Commits:** the relay never commits. The orchestrator reviews the diff and commits.
