> Saved as given (2026-11-04). Companion to [five-modes.md](five-modes.md) and
> [PROMPT-urban-ladder.md](PROMPT-urban-ladder.md). Built so far from its order: 1, the pipeline
> and the airport (engine.md, Pipelines; The airport).

# The three scales, and where every mode lives

Target: `main` at `77e9fe7`. Three scopes of work, then a home for every transport mode on
the open list. Add **§Scales** to `docs/brief.md` after *Player verbs*.

---

## Why

Today the game has two scales and nothing between them:

- **inside a town** — a number (`localTravel`), invisible, carried by kekes and okadas, and
  explicitly "not counted against you";
- **between towns** — the map, where everything else happens.

Every mode still on the list falls into the gap. A coach is just a bus with a longer line.
An okada may legally run an expressway. The metro is a button that earns a small fare and
changes nothing else. None of those are separate problems; they are the same missing middle.

**Three scales close it.** Nothing new for the player to learn — the rules are the ones
everybody already knows from life.

| Scale | What it is | Where the player meets it |
| --- | --- | --- |
| **Trunk** | long hops, regional town to regional town | the map, as now |
| **Feeder** | villages, sites, the approaches into a town | the map, but it is the informal sector's ground |
| **Inside** | journeys within one town | the town card |

**And it is what makes a town's own map possible later.** Once "inside a town" is a named
thing in the code instead of a number scattered across two files, a city view is something
you plug into it. Today there is nowhere to put one. That is the main reason to build the
structure now, before any of the modes.

---

## Scope 1 — Trunk

Mostly naming what already exists.

**A corridor knows its class.** `class: "trunk" | "feeder"` on a segment.

- **Default is derived**, so generated maps and the inherited network need no authoring: a
  corridor between two regional towns, or part of the old spine, is a trunk; everything else
  is a feeder.
- **The player declares it when building a road**, which is the whole point: it is one extra
  choice on a verb that already exists, and it is what bans okadas from that road. Your own
  rule — *every verb must create a decision* — is why this is declared rather than silently
  derived.
- **A trunk is a property, not a rung.** Like a bus lane: something a corridor has, not a
  step up the ladder. Do not let it become a fifth rung.
- **Declaring one has a price.** The union loses the road to its members; expect a demand.

**Open, and the owner's call:** can a corridor's class be changed after it is built, and what
does that cost? Not needed for scope 1 if the answer is "not yet".

Small. Delegable once the above is fixed.

## Scope 2 — Feeder

**No new buttons.** The owner's words: *"feeder, no action, just things like policy."*

Three rules, all reading scope 1's class:

1. Okadas and kekes may not run on a trunk. Danfos may, but pay the trunk's toll.
2. When you take a trunk — lane it, run BRT on it — the informal traffic displaced from it
   **appears on the feeders into it**, thicker, rather than vanishing. It reorganises around
   your investment instead of fighting it.
3. A feeder is where the last mile lives, and that stays true however good your trunk gets.

Small in code. **Not delegable:** it is inside the paratransit controller, which
`CLAUDE.md` reserves, and the second rule changes where demand goes.

## Scope 3 — Inside

The one with real design in it.

**A town's local journeys are one number with four slices:** walk, keke and okada, your city
line, and private cars. The slices sum to one.

**Only the car slice leaves the town.** It is what loads the approach roads — which
`private.ts` already does, driven today by population and growth alone, with nothing able to
reduce it.

What changes:

- `townCars` is computed from the car slice, not directly from population. A town with no
  city line and rising prosperity sees that slice grow.
- A city line (scope: the urban ladder, below) takes riders **out of the grey and the amber**
  in a stated ratio. One partition, one subtraction — not two separate ones, or the shares
  will not add up.
- The town card shows the bar. That is the whole UI for this scope.

**What it buys:** inside gains visible state, a way to fail on its own (a growing town chokes
your trunk), and a reason to build a city line that is not a ₦3 fare.

**Not delegable.** It changes what loads every road, so the strategist must re-measure C14
and C16 afterwards — cars coming off the approaches will move the late game.

---

## Where every mode lives

| Mode | Scale | What it needs | Size | Local build? |
| --- | --- | --- | --- | --- |
| bus, minibus, BRT, train, freight | trunk | built | — | — |
| **intercity coach** | trunk | terminals; long pairs only, terminal to terminal | medium | yes, once specified |
| **okada permission** | feeder | scope 1's class | small | no — paratransit |
| **urban ladder** (light rail · monorail · metro) | inside | scope 3 first | medium | no — growth and economy |
| **water** (jetties, boats) | a new trunk type | pathing on water, generator changes | large | **no** |
| **airport** | feeds the trunk | a gateway: demand at a point with no people | medium | yes |
| **pipeline** | outside all three | a capped link, a truck/pipe dial, a union hook | medium | yes |

Pipeline sits outside the scales entirely, which is part of why it was always the easy one:
it carries one commodity between two fixed points and touches nothing else.

---

## Order

1. **Pipeline** and **airport** — independent of the scales, both delegable. Do them while
   the scales are being settled.
2. **Scope 1, trunk.**
3. **Scope 3, inside** — before the urban ladder, because the ladder's reason to exist comes
   from it.
4. **Urban ladder**, rewritten on top of scope 3 (see below).
5. **Scope 2, feeder**, then **okada permission** with it.
6. **Intercity coach.**
7. **Water**, last, and together rather than delegated.

### A correction to `PROMPT-urban-ladder.md`

That prompt was written before scope 3 and should not be run as it stands. Its three rungs
and their numbers are still right; what is wrong is the reason they exist. It justifies a
city line by fares and a growth-cap lift. **After scope 3, a city line's main effect is
taking cars off your own approach roads**, and the three rungs should differ in how much of
the car slice each takes. Rewrite that section before handing it out.

---

## What this costs to run

The owner's pushback, answered plainly: **the split is free.**

It is one sum per town per game day — about thirty towns, once a day. A tick is roughly
1.4–2 ms and is almost entirely the 445 vehicles stepping thirty times a second. Thirty sums
a day does not register beside that.

It is free *because* a town's journeys stay one number with four slices rather than thousands
of simulated trips. That is the same discipline the rest of the engine follows, and it is
what keeps the expensive version — a real map per town — affordable later, since none of this
spends that budget.

---

## Open questions

- Can a corridor's class change after it is built, and at what price? (Scope 1.)
- What ratio does a city line draw from the informal slice against the car slice? It decides
  whether a line mainly relieves roads or mainly competes with okadas. Measure, do not guess.
- Does declaring a trunk need the union's consent, or only provoke a demand afterwards?

## Out of scope

- A per-town map. It is the point of the structure, not part of it. Later.
- Any change to how trips between towns are generated or priced.
- The corridor encoding and map density work — their own prompts, and they land first.

---

## To add to `docs/brief.md`, Decisions log

> **2026-11-03, three scales (proposed).** The game had two scales — a town's interior as an
> invisible number, and the map between towns — and every mode still on the list fell in the
> gap. Three scales close it: **trunk** (long hops, a corridor's declared class, which is
> what bans okadas from it), **feeder** (no new verbs, the informal sector's ground, where
> traffic displaced from a taken trunk reappears), and **inside** (a town's local journeys as
> one number in four slices — walk, informal, your city line, car — of which only the car
> slice loads your approach roads). A city line therefore exists to unjam your own trunk, not
> to earn a fare. The split is one sum per town per day and costs nothing. Naming "inside" in
> the code is also what makes a per-town map possible later.
