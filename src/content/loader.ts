import type { ZodType } from "zod";

export function parseContent<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export async function loadContent<T>(schema: ZodType<T>, url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load content from ${url}: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return parseContent(schema, data);
}
