// The 3D view's colours, read from tokens.css (docs/architecture/look.md §8: the same palette, the
// same world -- tokens, not literals). Signal colours by their own tokens (your blue, the informal
// yellow, goods, the roads' traffic, the flood); the world's paint -- walls, roofs, concrete,
// foliage, earth, sky -- by the `--paint-*` set. Read once each, when first asked: the 3D view is
// loaded on demand, after the page's styles.

const cache = new Map<string, string>();

/** A token's colour as CSS ("#rrggbb"). */
export function paint(name: string): string {
  let value = cache.get(name);
  if (value === undefined) {
    value = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache.set(name, value);
  }
  return value;
}

/** A token's colour as three.js takes it (0xrrggbb). */
export function paintHex(name: string): number {
  return parseInt(paint(name).replace("#", ""), 16) || 0;
}

/** A token's colour at an opacity, for a 2D canvas (which can't mix a CSS variable). */
export function paintAlpha(name: string, alpha: number): string {
  const n = paintHex(name);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
