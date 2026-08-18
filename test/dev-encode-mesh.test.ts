import { describe, expect, test } from "bun:test";
import { MAX_MESH_BYTES, bytesToBase64, meshTooLargeMessage } from "@dev/encodeMesh";

function pattern(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
  return bytes;
}

describe("bytesToBase64", () => {
  test("matches Buffer's encoding for a small payload", () => {
    const bytes = pattern(1000);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  // The actual regression. `btoa(String.fromCharCode(...bytes))` spreads
  // every byte as an argument and throws RangeError above the engine's
  // argument limit (~64-128 KB in V8). The original test fixture was a
  // 678-byte hand-built glTF -- three orders of magnitude below the
  // threshold -- so it passed while the first real .glb anyone loaded
  // blew the stack. These sizes straddle that limit deliberately.
  test.each([64 * 1024, 128 * 1024, 1024 * 1024, 5 * 1024 * 1024])(
    "encodes %i bytes without exhausting the call stack",
    (length) => {
      const bytes = pattern(length);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    },
  );

  test("round-trips back to the identical bytes", () => {
    const bytes = pattern(300_000);
    const decoded = Buffer.from(bytesToBase64(bytes), "base64");
    expect(decoded.length).toBe(bytes.length);
    expect(Buffer.from(bytes).equals(decoded)).toBe(true);
  });

  test("handles a payload that is not a whole number of chunks", () => {
    const bytes = pattern(0x2000 * 3 + 7);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("an empty buffer encodes to an empty string, not a throw", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });

  test("covers the full byte range, including the high bytes base64 is easiest to get wrong on", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("meshTooLargeMessage", () => {
  test("says nothing about a model that fits", () => {
    expect(meshTooLargeMessage(MAX_MESH_BYTES)).toBeNull();
  });

  test("explains itself in megabytes rather than bytes", () => {
    const message = meshTooLargeMessage(MAX_MESH_BYTES + 1)!;
    expect(message).toContain("MB");
    expect(message).toContain("24");
  });

  // base64 inflates by 4/3, so this is what keeps an accepted model from
  // being rejected by the dev server's payload cap instead.
  test("leaves room for base64 inflation under the writer's 32 MB payload cap", () => {
    expect(Math.ceil((MAX_MESH_BYTES * 4) / 3)).toBeLessThanOrEqual(32 * 1024 * 1024);
  });
});
