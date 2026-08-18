// Shared display formatting. One naira formatter, not one per panel: the
// Strip and the Lists showing the same number in two different roundings
// is exactly the "a visual must not say something the model doesn't mean"
// failure (docs/principles.md §3), just in miniature.
export function money(amount: number): string {
  return `₦${Math.round(amount).toLocaleString()}`;
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Escapes text that did not come from our own enums/numbers. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
