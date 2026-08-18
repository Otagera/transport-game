// Shared chrome for the studio drawer. Inline style objects rather than a
// stylesheet: src/dev/ must dead-code-eliminate cleanly out of the
// production build, and a CSS file imported from here would be pulled into
// the bundle graph by the bundler's asset handling rather than by the
// `import.meta.env.DEV` branch that guards everything else.
export const drawer = {
  position: "fixed",
  top: "0",
  right: "0",
  width: "380px",
  height: "100vh",
  background: "rgba(18, 18, 20, 0.94)",
  color: "#eee",
  font: "11px/1.5 monospace",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid #333",
  zIndex: "50",
} as const;

export const tabBar = {
  display: "flex",
  borderBottom: "1px solid #333",
  flexShrink: "0",
} as const;

export function tabButton(active: boolean) {
  return {
    flex: "1",
    padding: "8px 4px",
    background: active ? "#2a2a30" : "transparent",
    color: active ? "#ffe08a" : "#aaa",
    border: "none",
    borderBottom: active ? "2px solid #ffe08a" : "2px solid transparent",
    font: "11px/1.4 monospace",
    cursor: "pointer",
  } as const;
}

export const tabBody = {
  padding: "10px",
  overflowY: "auto",
  flex: "1",
} as const;

export const row = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  marginBottom: "6px",
} as const;

export const sectionTitle = {
  fontWeight: "bold",
  margin: "10px 0 4px",
  color: "#ffe08a",
} as const;

export const button = {
  width: "100%",
  padding: "5px",
  marginTop: "6px",
  background: "#2f2f38",
  color: "#eee",
  border: "1px solid #444",
  borderRadius: "3px",
  font: "11px/1.4 monospace",
  cursor: "pointer",
} as const;

export const note = {
  opacity: "0.6",
  fontSize: "10px",
  marginTop: "4px",
} as const;

export const errorNote = {
  color: "#ff8080",
  fontSize: "10px",
  marginTop: "4px",
  whiteSpace: "pre-wrap",
} as const;

/**
 * Every studio export goes out the same way: pretty JSON on the clipboard
 * with a console fallback, because clipboard access can be denied and a
 * silent failure would look like the export button doing nothing.
 */
export function exportJson(label: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  console.log(`[studio] ${label}\n${json}`);
  navigator.clipboard?.writeText(json).catch(() => {
    // Console output above is the fallback.
  });
}

/** Offers a file to the browser as a download. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
