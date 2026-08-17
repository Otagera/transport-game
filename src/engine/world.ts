export interface WorldState {
  tickCount: number;
}

export function createWorld(): WorldState {
  return { tickCount: 0 };
}

export function tickWorld(world: WorldState, _dt: number): void {
  world.tickCount += 1;
}
