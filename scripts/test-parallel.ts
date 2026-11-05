// The test suite across the machine's cores. `bun test` runs its files one after another in one
// process, on one core: 23 minutes of an eight-core machine's time, seven cores idle.
//
//   bun scripts/test-parallel.ts [file ...]     (bun run test:parallel; `verify` runs it)
//
// Each test file is a job, run as its own `bun test`. A file too long for one job (game.test.ts)
// is split by its top-level describe blocks into chunks, each run with `-t` on its blocks' names --
// and one chunk more takes every test the named blocks don't, so a test outside a block, or in a
// block whose name isn't a plain string, still runs: every test runs once, by construction.
// Jobs go longest first, by the timings the last run kept (.cache/test-times.json; line counts
// before there are any), on as many workers as the machine has cores free (TEST_WORKERS sets it),
// with CI's 30 s default timeout.
import { cpus, loadavg, tmpdir } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CACHE = join(ROOT, ".cache", "test-times.json");
/** A file whose last run took longer than this is split into chunks of about this. */
const CHUNK_SECONDS = 60;
/** Before any timings, a file this long is split, at about this many lines a chunk. */
const CHUNK_LINES = 600;

type Times = Record<string, number>; // "file" and "file\0describe" -> seconds
const times: Times = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

const asked = process.argv.slice(2).map((f) => relative(ROOT, join(process.cwd(), f)));
const files = (asked.length ? asked : readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`)).sort();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A file's top-level describe blocks whose names are plain strings, with their line counts. */
function blocks(source: string): { name: string; lines: number }[] {
  const out: { name: string; line: number }[] = [];
  const lines = source.split("\n");
  lines.forEach((text, i) => {
    const m = /^describe\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`$\\]*`)\s*,/.exec(text);
    if (!m) return;
    const literal = m[1]!;
    const name = literal.startsWith('"') ? JSON.parse(literal) : literal.slice(1, -1).replace(/\\(.)/g, "$1");
    out.push({ name, line: i });
  });
  // One entry a name: two blocks of the same name are one chunk's, or both would run twice.
  const byName = new Map<string, number>();
  out.forEach((b, i) => byName.set(b.name, (byName.get(b.name) ?? 0) + ((out[i + 1]?.line ?? lines.length) - b.line)));
  return [...byName].map(([name, n]) => ({ name, lines: n }));
}

/** `-t` for exactly these blocks: each name, then a space or the end -- but not another block's longer name. */
function namePattern(names: string[], all: string[]): string {
  const alts = names.map((n) => {
    const longer = all.filter((o) => o !== n && o.startsWith(`${n} `)).map((o) => escape(o.slice(n.length)));
    return `${escape(n)}${longer.length ? `(?!(?:${longer.join("|")})(?: |$))` : ""}`;
  });
  return `^(?:${alts.join("|")})(?: |$)`;
}

interface Job { file: string; label: string; pattern: string | null; blocks: string[]; estimate: number }

const jobs: Job[] = [];
for (const file of files) {
  const source = readFileSync(join(ROOT, file), "utf8");
  const lineCount = source.split("\n").length;
  const fileTime = times[file];
  const big = fileTime !== undefined ? fileTime > CHUNK_SECONDS * 1.5 : lineCount > CHUNK_LINES * 1.5;
  const named = big ? blocks(source) : [];
  if (named.length < 2) {
    jobs.push({ file, label: file, pattern: null, blocks: [], estimate: fileTime ?? lineCount / 50 });
    continue;
  }
  // Each block's cost: its time last run, else its share of the file by lines.
  const cost = (b: { name: string; lines: number }) => times[`${file}\0${b.name}`] ?? (fileTime !== undefined ? (fileTime * b.lines) / lineCount : b.lines / 50);
  const total = named.reduce((s, b) => s + cost(b), 0);
  const chunks = Math.max(2, Math.min(named.length, Math.ceil(fileTime !== undefined ? total / CHUNK_SECONDS : lineCount / CHUNK_LINES)));
  // Longest block first into the lightest chunk.
  const bins = Array.from({ length: chunks }, () => ({ names: [] as string[], estimate: 0 }));
  for (const b of [...named].sort((p, q) => cost(q) - cost(p))) {
    const bin = bins.reduce((lightest, x) => (x.estimate < lightest.estimate ? x : lightest));
    bin.names.push(b.name);
    bin.estimate += cost(b);
  }
  const all = named.map((b) => b.name);
  bins.forEach((bin, i) => jobs.push({ file, label: `${file} [${i + 1}/${chunks + 1}]`, pattern: namePattern(bin.names, all), blocks: bin.names, estimate: bin.estimate }));
  // The rest: whatever no named block's pattern takes.
  const rest = Math.max(0, (fileTime ?? total) - total);
  jobs.push({ file, label: `${file} [${chunks + 1}/${chunks + 1}: the rest]`, pattern: `^(?!(?:${all.map(escape).join("|")})(?: |$))`, blocks: [], estimate: rest });
}
jobs.sort((p, q) => q.estimate - p.estimate);

// The cores less half the load (the load average trails what's running now: just after a heavy
// job it still counts it), two at least, six at most.
const free = Math.round(cpus().length - 1 - loadavg()[0]! / 2);
const workers = Number(process.env.TEST_WORKERS) || Math.max(2, Math.min(6, free));
const out = mkdtempSync(join(tmpdir(), "test-parallel-"));
console.log(`${files.length} files as ${jobs.length} jobs on ${workers} workers (load ${loadavg()[0]!.toFixed(1)}, ${cpus().length} cores)`);

interface Result { job: Job; pass: number; fail: number; ok: boolean; seconds: number; output: string; junit: string }
const results: Result[] = [];
const started = performance.now();
let next = 0;

async function run(job: Job, index: number): Promise<Result> {
  const junit = join(out, `${index}.xml`);
  // CI's default timeout (ci.yml): several tests sit near bun's 5 s, and side by side on a busy
  // machine they cross it (three did, the first run). A test that sets its own keeps it.
  const cmd = ["bun", "test", `./${job.file}`, ...(job.pattern ? ["-t", job.pattern] : []), "--timeout", "30000", "--reporter=junit", `--reporter-outfile=${junit}`];
  const t0 = performance.now();
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: process.env });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  const output = stdout + stderr;
  const count = (word: string) => Number(new RegExp(`^\\s*(\\d+) ${word}$`, "m").exec(output)?.[1] ?? 0);
  const pass = count("pass");
  const fail = count("fail");
  // "The rest" may have nothing left in it: bun calls that an error; it isn't one.
  const empty = job.pattern !== null && job.blocks.length === 0 && /matched 0 tests/.test(output);
  return { job, pass, fail, ok: (code === 0 && fail === 0) || (empty && fail === 0), seconds: (performance.now() - t0) / 1000, output, junit };
}

async function worker(): Promise<void> {
  while (next < jobs.length) {
    const index = next++;
    const job = jobs[index]!;
    const r = await run(job, index);
    results.push(r);
    const mark = r.ok ? "ok  " : "FAIL";
    console.log(`${mark} ${r.job.label.padEnd(48)} ${String(r.pass).padStart(4)} pass ${r.fail ? `${r.fail} fail ` : ""}${r.seconds.toFixed(0).padStart(5)} s`);
  }
}
await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, worker));

// Keep the timings for next time: each file's (a split file's chunks added up), and each
// top-level block's (junit's testcase times summed under it; a test another chunk ran shows here
// skipped, at time 0, and isn't counted).
const fileSeconds = new Map<string, number>();
const blockSeconds = new Map<string, number>();
for (const r of results) {
  fileSeconds.set(r.job.file, (fileSeconds.get(r.job.file) ?? 0) + r.seconds);
  if (!existsSync(r.junit)) continue;
  const xml = readFileSync(r.junit, "utf8");
  let depth = 0;
  let top: string | null = null;
  for (const m of xml.matchAll(/<testsuite name="([^"]*)"|<\/testsuite>|<testcase [^>]*time="([\d.]+)"/g)) {
    if (m[0].startsWith("<testsuite")) {
      depth += 1;
      if (depth === 2) top = decode(m[1]!);
    } else if (m[0] === "</testsuite>") {
      if (depth === 2) top = null;
      depth -= 1;
    } else if (top !== null && Number(m[2]) > 0) {
      const key = `${r.job.file}\0${top}`;
      blockSeconds.set(key, (blockSeconds.get(key) ?? 0) + Number(m[2]));
    }
  }
}
for (const [key, seconds] of [...fileSeconds, ...blockSeconds]) times[key] = seconds;
function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
mkdirSync(join(ROOT, ".cache"), { recursive: true });
writeFileSync(CACHE, JSON.stringify(times, null, 1));
rmSync(out, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`\n==== ${r.job.label}\n${r.output.split("\n").filter((l) => !/^\(pass\)/.test(l)).join("\n")}`);
const pass = results.reduce((s, r) => s + r.pass, 0);
const fail = results.reduce((s, r) => s + r.fail, 0);
console.log(`\n${pass} pass, ${fail} fail, ${failed.length} of ${jobs.length} jobs failed, ${((performance.now() - started) / 1000).toFixed(0)} s`);
process.exit(failed.length ? 1 : 0);
