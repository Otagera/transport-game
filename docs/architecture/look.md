# The look

**The visual contract, as brief.md is the design contract.** A new screen element points at
a line in this file. Where this file and a screen disagree, this file wins; where it and
`principles.md` §3 disagree on a measured fact, principles wins.

Settled 2026-10-30 by rendering six candidates on the real game at seed 0, day 41: three
palettes (Survey sheet, Danfo, Terminal) and three layouts (Map-first, Two-pane, Board). The
direction below is the synthesis the renders produced, not any one of the six. (The renders
weren't kept in the repo; `bun run shots`, §9, makes them again.)

---

## 1. The direction, in a paragraph

**A state agency's working surface: ink and cream, with the region as a plate laid on it.**
The chrome is the ministry -- near-black, warm, unhurried, no colour of its own. The map is
the country, in daylight. Every colour on screen means something, because the chrome spends
none. The view is the middle distance, the same commitment the 3D view makes: a made object
with edges, not a window onto an infinite world.

Three rules carry it, and each came out of a render:

1. **The chrome has no hue.** Ink, cream, rule, and nothing else. Yellow is the informal
   sector; blue is you; orange and red are congestion. The Danfo render proved the cost of
   breaking this -- chrome yellow and danfo yellow sat side by side doing two different jobs
   and the map got harder to read, not easier.
2. **The water is the dark anchor.** `principles.md` has said since the first attempt that
   *"water should be a strong value area the built mass reads against"*, and no light
   version delivered one. A deep river under a warm pale land gives the frame its value
   structure. This is the single biggest gain in the whole pass.
3. **Nothing floats over the plate.** The map's own controls live in the left column. The
   playfield is the one region that stays clear.

---

## 2. Colour

Two layers, kept apart. **A restyle may change chrome freely and may never change signal.**

### Chrome -- the frame. No hue, no meaning.

| Token | Value | Job |
| --- | --- | --- |
| `--ink` | `#16130E` | text, filled controls, the strip |
| `--ink-2` | `#4A4335` | secondary text |
| `--muted` | `#8A8070` | labels, captions, section heads |
| `--surface` | `#F9F4EA` | panels, log, toolbar |
| `--surface-2` | `#F1E9DA` | recessed: list rows, the key, pledges |
| `--bg` | `#E6DECF` | behind everything |
| `--line` | `#D9CFBD` | every rule and border |

### Signal -- data. Meanings are fixed; only values may be tuned for contrast.

| Token | Value | Means |
| --- | --- | --- |
| `--you` | `#1C6CA8` | your service, your riders, your vehicles |
| `--informal` | `#F2B705` | danfos, kekes, okadas -- **never chrome** |
| `--goods` | `#A8673A` | trucks, freight |
| `--road-free` / `--road-busy` / `--road-jammed` | `#CFC3AC` / `#DD6B20` / `#C0392B` | road traffic |
| `--good` / `--bad` / `--warn` | `#1E7A4F` / `#C0392B` / `#C8880F` | verdicts |
| `--home` | `#B3AA97` | stayed home |
| site families | `#C0392B` fuel · `#6B4FA8` building · `#1E7A4F` food · `#1C6CA8` trade | the four chains (today hard-coded in `icons.ts` `FAMILY_COLOR`: to become tokens) |
| `--map-ground` / `--map-water` / `--map-hill` | `#F2EDE1` / `#2C4A57` / `#9A8E72` | terrain |

Route line colours (`labels.ts`) keep their own slots and are drawn from the signal layer; the lists' route swatches are `--route-1` to `--route-8`.

---

## 3. Type

System stack, until someone decides a webfont is worth its cost to the Docker build.
Figures are tabular everywhere a number can change.

| Step | Size / weight | Used for |
| --- | --- | --- |
| headline | 19px / 650 | the strip's three numbers, a town card's name |
| body | 13px / 400 | panel and log prose |
| dense | 12px / 400 | list rows, route cards, tables |
| caption | 11px / 400 | deltas, hints, secondary lines |
| label | 11px / 600, uppercase, `0.07em` | section heads, group captions |

A screen uses these five and no others. No step exists for emphasis alone -- weight and
colour do that. (The correspondent's letters keep `--letter-font`: a letter, not a screen.)

---

## 4. Spacing and shape

- **Unit: 4px.** Padding, gaps and margins are multiples of it.
- Panel padding `14px`; list row padding `6px 8px`; section gap `14px`.
- **Radius: 8px** for panels and cards, `6px` for controls, `0` for anything that meets a
  screen edge.
- **One elevation.** Docked surfaces get a `1px var(--line)` border and no shadow. Only a
  thing that genuinely floats above the page -- a toast, a modal -- gets a shadow.

---

## 5. Controls: four roles, one style each

Two was too few; the screen has four jobs and they are distinguishable. Nothing else is a
button.

| Role | Looks like | Used for |
| --- | --- | --- |
| **primary** | filled `--ink`, cream text | the one committing action on a card: Pledge, Choose your pledges, Raise a bridge |
| **quiet** | `--surface` with a `--line` border | everything ordinary: Revenue, pager, panel actions |
| **toggle** | quiet; `--ink` filled when on | mutually exclusive sets: the overlay tabs, panel tabs, log filters, speeds |
| **tool** | quiet, with its key in a `kbd` | the toolbar: Bus **B**, Road **R**, Fix **F** |

A key hint is always a `kbd` at 11px mono at 60% opacity, never parentheses in the label --
a card's "Yard at Ilugun (Y)" included.

---

## 6. Layout

Four regions, fixed. The rule that sets them: **a region earns its width by what it holds
at every stage of a game, not by its category.** Day 41 on seed 0 is the test case -- the
old left column held two log lines and the old right panel held one notice.

```
┌──────────────────────────────────────────────────────────────┐
│  STRIP   ink. term · three numbers · Revenue                 │
├──────────┬────────────────────────────────────┬──────────────┤
│ CONTROLS │                                    │   PANEL      │
│  236px   │            THE PLATE               │   352px      │
│          │                                    │              │
│ zoom·3D  │   the region. nothing over it.     │ waiting on   │
│ overlays │                                    │ you · pledges│
│ log      │                                    │ · tabs ·     │
│ key      │                                    │ inspector ·  │
│          ├────────────────────────────────────┤ the log's    │
│          │  TOOLBAR  docked, not floating     │ detail       │
└──────────┴────────────────────────────────────┴──────────────┘
```

- **The strip** is ink, and holds the term, exactly three numbers (people, trips made, money)
  and the Revenue button. The other three stats live behind Revenue. Sparklines stay.
- **Controls** holds everything that acts on the map: zoom, 3D, the overlay set, the log,
  and the key as a collapsed chip. This is what makes the column worth its width and the
  plate clear at the same time.
- **The plate** is the map and nothing else. It fills its region; it is never overlapped.
  In 3D, its camera buttons (turn, tilt, night) move to the controls column with zoom.
- **The panel** holds what is waiting on you, the term's pledges, the tabs, and whatever is
  selected. When it has little to show it narrows rather than holding space open.
- **The toolbar** is docked to the bottom of the plate's column with a top rule. It does
  not float.

### Settled by the renders, regardless of anything above

- Three stats, not six.
- The key is a chip, opened on demand. It is a manual, not furniture.
- The hint goes inline in the panel. Nothing instructional floats on the plate.
- Pledges move out of the strip into the panel, where they are not truncated. "Halve those
  left without a seat at Ilase: 218 a day to 109" is the most important sentence on the
  screen and the strip was cutting it at thirty characters.

---

## 7. Motion

- Panel open, selection change, tab change: **120ms**, `cubic-bezier(.2,.8,.2,1)`.
- A number in the strip changing: a 200ms tint, no counting animation.
- **The plate never animates.** The simulation is already moving; anything else on it is
  noise. (So the ring round the places a card's button names, render.ts `drawPointedRing`,
  is steady, not pulsing.)
- Nothing eases on first paint.

---

## 8. The 3D view

The same palette, the same world. `shapes3d.ts` and `view3d.ts` read the tokens above
(`palette3d.ts`; done 2026-10-30): signal by its own tokens, the world's paint by `--paint-*`. Then, in order -- these are `principles.md`
§Visual direction, which the view was built without applying:

1. **Albedo separation before lighting.** The ground is one sage across most of the plate.
2. **A dark value anchor**, the same river that anchors the 2D map.
3. **Contact shadows**, geometry-based. Never full-framebuffer AO: it eats the corridor
   signal channel.
4. **The plate sits on something** rather than floating in a flat gradient.
5. **Road and rail as distinct channels** -- width and surface, not hue or brightness, which
   are taken.

**Done 2026-10-30** (view3d.ts): (1) the ground's dry and green pushed apart in lightness before
lighting (`offsetHSL` by dryness); (2) the day's water deep is `--map-water`, its shallows a third
toward the sky; (3) a soft `--ink` footprint instanced under every building (`contactMaterial`,
`softBlob`), no screen-space AO; (4) a table in `--bg` under the plate, its shadow soft beneath it;
(5) track as a narrow ballast bed, a timber sleeper band and two thin dark rails, against a road's
one wide surface.

---

## 9. Enforcement

In `bun run verify` (typecheck, test, build, verify:bundle, then these: `scripts/verify-look.ts`,
`bun run verify:look` alone), so the direction holds without anyone remembering it. The 3D view reads
the same tokens (`palette3d.ts`): its signal colours by their own, its paint by `--paint-*`.

| Check | Fails when |
| --- | --- |
| **No literals** | a hex colour, a `px` font-size or a `px` spacing value appears in `src/game/` outside `src/game/styles/tokens.css` -- the one source; TS reads it (render.ts `token()`; the 3D view the same way). Allowlist: geometry maths in `shapes3d.ts`, which is positions |
| **Four roles** | a button is created with a class outside the four in §5 |
| **Tokens agree** | the values in `tokens.css` and the tables in §2 have drifted apart |
| **Signal untouched** | a signal token's value changed without its row in §2 changing with it |

`scripts/shots.ts` (`bun run shots [seed]`) captures the five screens on demand at 1600×1000 @2x --
the map, a town picked, Revenue, the term's pledges, 3D -- into `shots/` (not in git). It
measures; it does not gate.

---

## 10. Known open, from the renders

Named so they are not mistaken for decisions.

- **The plate does not fill its region.** It keeps a fixed aspect and leaves cream below and
  to the right. It should fill, or be centred with a deliberate margin -- not neither.
- **The panel is still thin on content** at day 41: one notice and an empty route list. The
  term letters and then-and-now are built (2026-10-30) but on the term's verdict screen, not
  in the panel; the pledges moving in (§6) are what fill it. Until then it should narrow
  when it has little.
- **The strip is tall** -- three pledge rows and the map line push it past 160px. Moving the
  pledges into the panel (§6) is most of the fix.
- **Contours read as smudges** near Ilaro rather than as terrain.
- **A webfont** is undecided; the system stack holds until it is.
