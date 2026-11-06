// The welcome page, the tour and Help (brief, The screen, again, 5; asked 2026-11-06: "most
// persons will skip hints, we need the welcome explainer and help button to explain different
// parts of the game"). The page says what the game is and offers the tour or play; the tour
// lights each part of the screen in turn, Next and Skip; Help (in the strip) reopens either, or
// explains one part. Kept off the world: nothing here reads or changes the simulation.

export interface TourStep {
  id: string;
  title: string;
  text: string;
  /** What it lights, tried in order: the first that's on the page and visible. None: the card in the middle. */
  targets: string[];
}

export const TOUR: TourStep[] = [
  {
    id: "strip",
    title: "The strip",
    text: "The day and your term at the left. <b>People</b> is your score: how many live in the towns you started with. <b>Trips made a day</b> is everyone's, yours and the danfos'. <b>Money</b> is what you hold. The line under each is the last 30 days. At the right, pause and the three speeds (Space, 1, 2, 3), and Help.",
    targets: ["#strip"],
  },
  {
    id: "map",
    title: "The map",
    text: "Towns, sized by their people, with their roads, the old railway and the rivers. A road's colour is its traffic, from free to jammed; your lines run in your colour. Click a town or a site for its card. Wheel to zoom, drag to pan, 0 to see it all.",
    targets: ["#plate-overlay", "#map"],
  },
  {
    id: "layers",
    title: "What the map shows",
    text: "<b>Traffic</b> is the plain map. <b>Demand</b> draws where people want to go, <b>No seat</b> where they wanted a seat and found none, <b>Informal share</b> who carries them, <b>Goods</b> where goods go. Below, the networks one at a time: roads, rail, water, pipes. Under that, what happened, newest first.",
    targets: ["#overlays", "#controls-col"],
  },
  {
    id: "waiting",
    title: "Waiting on you",
    text: "The moves that matter now, worst first: a cement works standing idle, travellers stranded, a strike. Each says why and has its button. If nothing's here, the network is running well.",
    targets: ["#panel .pane.waiting", "#panel-col"],
  },
  {
    id: "pledges",
    title: "Your term",
    text: "Each term you pledge to fix some of the region's problems. Keep them and your term is a success; fail two terms and you're replaced. The bar under each shows how close you are.",
    targets: ["#panel .pane.pledges-pane", "#panel-col"],
  },
  {
    id: "toolbar",
    title: "Build and run",
    text: "<b>Vehicles</b>: pick one, click a town, then another, and it runs between them. The line shows what it costs and who wants to go. <b>Build</b>: roads, track, pipes, jetties, haulage yards, motor parks, bus stations, and Fix to keep a road up. The grey letter is each tool's key.",
    targets: ["#toolbar"],
  },
  {
    id: "informal",
    title: "The other side",
    text: "Danfos, kekes and okadas carry whoever you don't. They aren't enemies: where your buses run often and full, people ride with you; where they don't, the informal sector fills the gap. The towns grow with the trips they make.",
    targets: [],
  },
];

const WELCOMED = "game:welcomed";

/** Whether this browser has seen the welcome page. */
export function welcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED) !== null;
  } catch {
    return true; // storage refused (a private window): don't open it on every load
  }
}

function markWelcomed(): void {
  try {
    localStorage.setItem(WELCOMED, "1");
  } catch {
    // fine: it opens again next time
  }
}

export interface Welcome {
  /** The welcome page. `then` runs when it and any tour it led to are closed. */
  openWelcome(then?: () => void): void;
  /** The tour from a step, or one step alone (Help's list). */
  startTour(from?: number, single?: boolean, then?: () => void): void;
  /** Help's menu, under the strip's button. */
  toggleHelp(anchor: HTMLElement): void;
  isOpen(): boolean;
}

export function createWelcome(): Welcome {
  const page = document.querySelector<HTMLElement>("#welcome")!;
  const tour = document.querySelector<HTMLElement>("#tour")!;
  let after: (() => void) | null = null;
  let step = 0;
  let single = false;

  const finish = () => {
    page.classList.remove("open");
    tour.classList.remove("open");
    tour.innerHTML = "";
    window.removeEventListener("resize", place);
    const then = after;
    after = null;
    then?.();
  };

  function openWelcome(then?: () => void): void {
    after = then ?? after;
    markWelcomed();
    page.innerHTML = `
      <div class="title">A transport game</div>
      <p class="lede">You're the region's transport builder: a fictional corner of Nigeria, its towns, the
      roads it inherited, an old railway out of service, and rivers. People want to get between the towns,
      and goods have to reach them. Where nobody carries them, danfos and okadas do, or they stay home.</p>
      <ul>
        <li><b>Run lines</b> between towns -- buses and minibuses, trains, boats -- and they pay their fares.</li>
        <li><b>Build</b> what they run on: roads, track, jetties; and what the region needs, from haulage yards to the cement works' restoration.</li>
        <li><b>Keep your pledges</b> each term. The towns you serve grow; the money comes from fares and the state's allocation.</li>
      </ul>
      <p class="lede">There's no single right way. The game pauses whenever you like (Space).</p>
      <div class="buttons"><button class="primary" data-welcome="tour">Take the tour</button><button class="quiet" data-welcome="play">Just play</button></div>`;
    page.classList.add("open");
  }

  /** The lit part's box, or null for a card in the middle. */
  function targetRect(s: TourStep): DOMRect | null {
    for (const sel of s.targets) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== "hidden") return r;
    }
    return null;
  }

  function place(): void {
    const s = TOUR[step]!;
    const r = targetRect(s);
    const ring = tour.querySelector<HTMLElement>(".ring")!;
    const card = tour.querySelector<HTMLElement>(".card")!;
    if (!r) {
      ring.hidden = true;
      card.style.left = `${Math.max(16, (innerWidth - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.max(16, (innerHeight - card.offsetHeight) / 2)}px`;
      return;
    }
    ring.hidden = false;
    Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    // Beside the part where there's room, else over it, kept on the screen.
    const w = card.offsetWidth, h = card.offsetHeight, gap = 14;
    let x = r.right + gap, y = r.top;
    if (x + w > innerWidth - 8) x = r.left - w - gap;
    if (x < 8) {
      x = Math.min(Math.max(8, r.left + (r.width - w) / 2), innerWidth - w - 8);
      y = r.bottom + gap + h < innerHeight ? r.bottom + gap : r.top - h - gap;
    }
    card.style.left = `${Math.max(8, x)}px`;
    card.style.top = `${Math.min(Math.max(8, y), innerHeight - h - 8)}px`;
  }

  function show(): void {
    const s = TOUR[step]!;
    const last = single || step === TOUR.length - 1;
    tour.innerHTML = `<div class="ring"></div><div class="card" role="dialog" aria-label="${s.title}">
      <div class="k">${single ? "Help" : `${step + 1} of ${TOUR.length}`}</div>
      <div class="title">${s.title}</div>
      <p>${s.text}</p>
      <div class="buttons">${single ? "" : `<button class="quiet" data-tour="skip">Skip the tour</button>`}${!single && step > 0 ? `<button class="quiet" data-tour="back">Back</button>` : ""}<button class="primary" data-tour="${last ? "done" : "next"}">${last ? "Done" : "Next"}</button></div>
    </div>`;
    tour.classList.add("open");
    place();
  }

  function startTour(from = 0, alone = false, then?: () => void): void {
    after = then ?? after;
    page.classList.remove("open");
    step = Math.max(0, Math.min(TOUR.length - 1, from));
    single = alone;
    window.addEventListener("resize", place);
    show();
  }

  function toggleHelp(anchor: HTMLElement): void {
    if (tour.classList.contains("open") && tour.querySelector(".help")) {
      finish();
      return;
    }
    const r = anchor.getBoundingClientRect();
    tour.innerHTML = `<div class="help" style="top:${r.bottom + 6}px; right:${Math.max(8, innerWidth - r.right)}px">
      <button class="quiet" data-help-open="welcome">What this game is</button>
      <button class="quiet" data-help-open="tour">Take the tour</button>
      <div class="k">Explain</div>
      ${TOUR.map((s, i) => `<button class="quiet" data-help-step="${i}">${s.title}</button>`).join("")}
    </div>`;
    tour.classList.add("open");
  }

  page.addEventListener("click", (event) => {
    const which = (event.target as HTMLElement).closest<HTMLElement>("[data-welcome]")?.dataset.welcome;
    if (which === "tour") startTour(0);
    else if (which === "play") finish();
  });
  tour.addEventListener("click", (event) => {
    const el = event.target as HTMLElement;
    const t = el.closest<HTMLElement>("[data-tour]")?.dataset.tour;
    if (t === "next") {
      step += 1;
      show();
    } else if (t === "back") {
      step -= 1;
      show();
    } else if (t === "skip" || t === "done") finish();
    const open = el.closest<HTMLElement>("[data-help-open]")?.dataset.helpOpen;
    if (open === "welcome") openWelcome();
    else if (open === "tour") startTour(0);
    const one = el.closest<HTMLElement>("[data-help-step]")?.dataset.helpStep;
    if (one !== undefined) startTour(Number(one), true);
    // A click outside Help's menu closes it.
    if (tour.querySelector(".help") && !el.closest(".help")) finish();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (page.classList.contains("open") || tour.classList.contains("open"))) {
      event.stopPropagation();
      finish();
    }
  }, true);

  return { openWelcome, startTour, toggleHelp, isOpen: () => page.classList.contains("open") || (tour.classList.contains("open") && !tour.querySelector(".help")) };
}
