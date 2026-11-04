> Saved as given (2026-11-04). Not to be run as it stands: per [five-modes.md](five-modes.md),
> "Already scoped, needing one correction", its rungs and numbers hold but its *reason* is to be
> rewritten on top of the inside scope ([SCALES-AND-MODES.md](SCALES-AND-MODES.md)) -- a city line
> exists mainly to take cars off your own approach roads, the three rungs differing in how much of
> the car slice each takes. Its line references are to `main` at `624fcb2`.

# The urban ladder: three city modes on the town card

Target: `main` at `624fcb2`. **Scoped for a local model.** Every number and every rule below
is decided. Implement exactly what is written; do not substitute values, do not add a mode,
do not "improve" a formula. Where something is genuinely ambiguous, stop and ask rather than
choosing — per `CLAUDE.md`, demand, economy and growth model decisions are not delegated.

---

## What this is

The game has one city mode, the metro (`src/engine/game/metro.ts`, 95 lines). It is the
answer to a long-open question: **the city is a card, not a map.** Urban transport is decided
on a town's panel and changes that town's aggregate — no streets, no second map, no geometry.

This generalises that one mode into three rungs of a ladder. `metro.ts` is already the
template and its shape does not change; it gains a kind.

Three rungs, differing on four axes — price, how many of a town's inside trips they take,
whether they cost road capacity, and whether street trouble stops them:

| | **Light rail** | **Monorail** | **Metro** |
| --- | --- | --- | --- |
| what it is | trams on the street | elevated, on piers | underground |
| min population (k) | 80 | 150 | 200 |
| first line | ₦45,000 | ₦110,000 | ₦150,000 |
| each further line | ₦35,000 | ₦80,000 | ₦100,000 |
| max lines | 2 | 2 | 3 |
| share of inside trips, per line | 0.08 | 0.12 | 0.15 |
| fare a rider | ₦3 | ₦3 | ₦3 |
| running, a line a day | ₦120 | ₦220 | ₦300 |
| growth cap share (all lines) | 0.12 | 0.22 | 0.30 |
| costs approach road capacity | **yes, 0.12 a line** | no | no |
| stopped by a strike on the town's roads | **yes** | no | no |

**The metro's column is unchanged from today's tuning.** That is deliberate: existing runs,
strategist numbers and the brief's checks still compare.

Light rail is the rung most towns can actually take — it reaches down to 80k, where the metro
needs 200k — and it pays for that by sharing the street: it eats road capacity on the town's
approaches, and when the union blocks those roads the trams stop with everything else.
Monorail is the middle: no street cost, no strike exposure, a real price.

**One kind per town.** A town that has built light rail cannot also build a metro. Upgrading
between kinds is **not in this change** — see Out of scope.

---

## Step 1 — The kind

In `src/engine/game/metro.ts`, rename nothing yet; add:

```ts
export type UrbanKind = "lightrail" | "monorail" | "metro";
```

State moves from `world.metros: Map<string, number>` to:

```ts
world.urban: Map<string, { kind: UrbanKind; lines: number }>
```

`types.ts:917` and `world.ts:156` are the two places that declare and create it.

**Keep `metroLines(world, townId)` working**, returning the line count whatever the kind, so
callers that only need a count do not all change at once.

## Step 2 — The table, in tuning

Put the table above in `src/engine/game/tuning.ts` as one record keyed by kind, beside the
existing metro block (lines 263–278). Replace the eight `metro*` fields with the record; keep
`metroEnabled` as the switch for the whole ladder and rename it `urbanEnabled`, leaving a
`metroEnabled` alias if anything outside the module reads it.

Every number above is a first guess to measure with the strategist. Put them in the table and
nowhere else — no literal from that table may appear in a function body.

## Step 3 — The functions

Each existing function takes the kind from `world.urban` rather than from a global:

- `insideTrips` — unchanged.
- `metroRiders` → `urbanRiders(world, townId)`: `share = lines * table[kind].lineShare`, then
  **if the kind is light rail and the town's roads are blocked by a strike, riders are 0 for
  that tick** (read the same flag the lane blocking already uses in `union.ts`/`pushback.ts`;
  do not invent a new one).
- `metroPrice` → `urbanPrice(world, townId, kind)`: first line or further, from the table.
- `checkMetro` → `checkUrban(world, townId, kind)`: the switch, the town exists and is not a
  site, population at least the kind's minimum, lines below the kind's maximum, **the town has
  no other kind already**, and it is affordable. Each failure keeps a reason in the existing
  style ("a metro needs a town of 200k", "it has all 3 lines", and a new "Iwo already has
  light rail").
- `buildMetro` → `buildUrban(world, townId, kind)`: charge, increment, set the kind on first
  build.
- `runMetros` → `runUrban`: fares and running per kind, into `world.budget.metro` as now.
- `metroGrowthShare` → `urbanGrowthShare`: `table[kind].capShare * lines / table[kind].maxLines`.

`growth.ts` calls `metroGrowthShare`; update the call site, not the growth formula.

## Step 4 — Light rail takes approach capacity

The only part that reaches outside the town card.

In `congestion.ts`'s `roadCapacity(world, segmentId)`: if either end of the segment is a town
with light rail, multiply capacity by `(1 - 0.12 * lines)` for that town, once per end
(so a road between two light-rail towns is reduced twice).

Only roads. Rail segments are untouched. Do not touch `private.ts` — a town's cars are not
part of this change.

## Step 5 — The action, and old runs

`actions.ts:166` calls `buildMetro(world, spec.townId)`. Give the action spec an optional
`mode?: UrbanKind` and **default it to `"metro"` when absent**.

That is the whole migration. Runs replay from the action log (`runlog.ts`), not from a state
snapshot, so every existing run file replays identically with the default. **Do not bump any
format.** Verify this rather than assuming it: replay an existing run with
`bun scripts/game-run.ts <run>.json --verify` before and after and confirm it still
reproduces.

## Step 6 — On the town card

Today the metro sits behind the "More" fold (`screen.ts:968`), which is the same mistake the
brief names for the cement works' restore button.

Bring the ladder out of the fold onto the town card proper, as one block:

- the rung the town has, if any, with its lines and what they carry;
- the rungs it could have, each with its price and what a line would carry — and for light
  rail, a line saying it shares the street;
- a rung the town is too small for is shown with its population threshold, not hidden;
- one **primary** button per affordable rung, `quiet` when not affordable
  (`look.md` §5 — do not invent a button class).

The existing per-mode strings on the card ("Metro fares" in the revenue screen at
`screen.ts:1341`, the budget keys at 1348 and 1436) keep the `metro` key; only their label
becomes "City lines".

---

## Tests

In `test/`, as `.test.ts`. Each must fail when its fix is reverted — check that.

1. Each kind's riders equal `lines * lineShare * insideTrips`, at one and at maximum lines.
2. A town cannot build a second kind: `checkUrban` fails with the new reason.
3. Population gates: a 100k town accepts light rail, refuses monorail and metro.
4. Line caps: light rail and monorail stop at 2, metro at 3.
5. Growth share is `capShare * lines / maxLines` for each kind, and 0 with no lines.
6. **Light rail and a strike:** with the town's roads blocked, its riders are 0 and its
   running cost is still charged; monorail and metro in the same town-state are unaffected.
7. **Approach capacity:** a road between a light-rail town (2 lines) and a plain town has
   capacity `0.76` of its base; between two such towns, `0.76 * 0.76`; a monorail town
   changes nothing.
8. **Old runs replay:** an action log containing a `metro` action with no `mode` builds a
   metro and reproduces.

## Verification

```
bun run verify
bun run shots
bun scripts/game-run.ts <an existing run>.json --verify
```

Then the strategist on five seeds to day 250, reporting for each: trips made a day, net a
day, people, money held, how many towns built which rung, and C14's longest stretch with
nothing worth building. Compare against the same five seeds on `main` before the change.
**The metro's own numbers must not move** — if they do, the metro column was not kept
identical and that is a bug, not a result.

## Out of scope — do not build these

- **Upgrading between kinds.** Deferred deliberately; it needs a rule for what happens to the
  lines already paid for, and that is a design decision.
- Mixing kinds in one town.
- Any change to `private.ts`, to how a town's cars are computed, or to the growth formula
  itself — only its call site moves.
- Any change to the metro's eight numbers.
- Stations, stops, or anything drawn on the map. This ladder exists on the card.
- The other modes from the 2026-10-30 session (water, intercity coach, the airport gateway,
  the okada permission rule, the pipeline dial). Each is its own piece of work.

---

## To add to `docs/brief.md`, Decisions log

> **2026-11-03, the urban ladder (proposed).** The city is a card, not a map: urban transport
> is decided on a town's panel and changes that town's aggregate. `metro.ts` generalises to
> three rungs — light rail, monorail, metro — differing on price, share of inside trips,
> whether they cost approach road capacity, and whether a strike on the town's roads stops
> them. Light rail reaches down to 80k towns and pays for it by sharing the street; the
> metro's numbers are unchanged so existing runs and checks still compare. One kind per town;
> upgrading between kinds deferred. Old run files replay unchanged, the action's `mode`
> defaulting to `metro`.
