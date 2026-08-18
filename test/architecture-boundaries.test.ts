import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Hard rule (docs/rebuild-plan.md §4): engine/ imports nothing from
// render/, content/, ui/, dev/, or three.js. Pure simulation.
//
// ui/ and dev/ were added to the list in Module 11, which gave both of
// them a lot more surface to be tempted by: ui/inspector.ts reads engine
// state to build its panels and dev/ authors content the engine consumes,
// so the pressure to close the loop the wrong way round is real now in a
// way it wasn't when ui/ was four read-only text panels.
const ENGINE_DIR = join(import.meta.dir, "..", "src", "engine");
const FORBIDDEN_PREFIXES = ["three", "@render", "@content", "@ui", "@dev"];
const FORBIDDEN_SUBSTRINGS = ["/render/", "/content/", "/ui/", "/dev/"];

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function isForbidden(specifier: string): boolean {
  if (FORBIDDEN_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))) {
    return true;
  }
  return FORBIDDEN_SUBSTRINGS.some((substring) => specifier.includes(substring));
}

describe("engine/ import boundary", () => {
  test("engine/ imports nothing from render/, content/, ui/, dev/, or three.js", () => {
    const files = collectTsFiles(ENGINE_DIR);
    const violations: string[] = [];

    for (const file of files) {
      for (const specifier of importSpecifiers(file)) {
        if (isForbidden(specifier)) {
          violations.push(`${file}: imports "${specifier}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
