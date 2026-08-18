// Binary -> base64 for the mod package upload.
//
// The obvious one-liner, `btoa(String.fromCharCode(...new Uint8Array(buf)))`,
// is a trap: the spread passes every byte as a separate argument, so it
// throws RangeError: Maximum call stack size exceeded once the file is
// bigger than the engine's argument limit -- around 64-128 KB in V8. That
// is far below any real .glb, which is why it survived a 678-byte test
// fixture and died on the first actual model somebody loaded.
//
// FileReader.readAsDataURL would also work and is native, but it does not
// exist in Bun, so it could not be unit-tested here. Chunking is the
// version that can have a regression test pointed at it.
const CHUNK_BYTES = 0x2000;

// Deliberately well under the observed limit rather than just under it:
// the ceiling is a *stack* limit, so it depends on how deep the call stack
// already is when this runs, not on a fixed number of arguments.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_BYTES));
  }
  return btoa(binary);
}

// Kept in step with MAX_BYTES in scripts/studio-mod-writer.mjs: base64
// inflates by 4/3, so 24 MB of mesh is the largest thing that fits in the
// server's 32 MB payload cap. Checked here so an oversized model gets a
// sentence explaining itself, rather than a raw 413 from the dev server
// after spending several seconds encoding.
export const MAX_MESH_BYTES = 24 * 1024 * 1024;

export function meshTooLargeMessage(byteLength: number): string | null {
  if (byteLength <= MAX_MESH_BYTES) return null;
  const mb = (byteLength / (1024 * 1024)).toFixed(1);
  return `Model is ${mb} MB; the mod writer accepts up to ${MAX_MESH_BYTES / (1024 * 1024)} MB.`;
}
