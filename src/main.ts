import { Accumulator, SIM_DT } from "@engine/loop";
import { createWorld, tickWorld } from "@engine/world";
import { loadContent } from "@content/loader";
import { EraListSchema } from "@content/schema";
import { createScene } from "@render/scene";
import { createStatusBar } from "@ui/statusBar";

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#scene");
  const statusEl = document.querySelector<HTMLDivElement>("#status");
  if (!canvas || !statusEl) {
    throw new Error("Missing #scene canvas or #status element in index.html");
  }

  const eras = await loadContent(EraListSchema, "/content/eras.json");
  const currentEraName = eras[0]?.name ?? "unknown";

  const { renderer, scene, camera, resize } = createScene(canvas);
  const world = createWorld();
  const accumulator = new Accumulator(SIM_DT);
  const statusBar = createStatusBar(statusEl);

  window.addEventListener("resize", resize);

  let last = performance.now();
  let framesSinceSample = 0;
  let timeSinceSample = 0;
  let fps = 0;

  function frame(now: number): void {
    const elapsed = (now - last) / 1000;
    last = now;

    accumulator.advance(elapsed, (dt) => tickWorld(world, dt));

    framesSinceSample += 1;
    timeSinceSample += elapsed;
    if (timeSinceSample >= 0.5) {
      fps = Math.round(framesSinceSample / timeSinceSample);
      framesSinceSample = 0;
      timeSinceSample = 0;
    }

    statusBar.render({ tick: world.tickCount, fps, era: currentEraName });

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
});
