/**
 * Execute-path tests for the career-ops model's `import-all` method, using a
 * lightweight fake method context (no swamp test harness required). Covers the
 * success path (writes app + pipeline resources from a real temp tracker) and
 * the failure path (missing tracker throws before any write).
 *
 * @module
 */
import assert from "node:assert/strict";
import { model } from "./career-ops.ts";

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 2 | 2026-07-10 | Beta | Engineer II | 4.1/5 | Applied | ✅ | [002](../reports/002-beta.md) | applied |
| 1 | 2026-07-01 | Acme | Engineer | 3.2/5 | Evaluated | ❌ | [001](../reports/001-acme.md) | pass |
`;

interface Write {
  spec: string;
  name: string;
  data: Record<string, unknown>;
}

function fakeContext(trackerPath: string) {
  const writes: Write[] = [];
  const context = {
    globalArgs: { careerOpsDir: "/unused", trackerPath },
    writeResource: (
      spec: string,
      name: string,
      data: Record<string, unknown>,
    ) => {
      writes.push({ spec, name, data });
      return Promise.resolve({ name });
    },
    logger: { info: () => {} },
  };
  return { context, writes };
}

// deno-lint-ignore no-explicit-any
const importAll = (model.methods as any)["import-all"].execute;

Deno.test("import-all: writes one application resource per row plus the aggregate", async () => {
  const path = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(path, TRACKER);
  const { context, writes } = fakeContext(path);

  const result = await importAll({}, context);

  const apps = writes.filter((w) => w.spec === "application");
  const pipelines = writes.filter((w) => w.spec === "pipeline");
  assert.equal(apps.length, 2);
  assert.equal(pipelines.length, 1);
  assert.deepEqual(apps.map((w) => w.name).sort(), ["app-001", "app-002"]);

  const beta = apps.find((w) => w.name === "app-002")!.data;
  assert.equal(beta.company, "Beta");
  assert.equal(beta.status, "Applied");
  assert.equal(beta.scoreValue, 4.1);
  assert.equal(beta.pdf, true);
  assert.equal(typeof beta.updatedAt, "string");

  const agg = pipelines[0].data;
  assert.equal(agg.total, 2);
  assert.deepEqual(agg.funnel, { Applied: 1, Evaluated: 1 });
  assert.equal(result.dataHandles.length, 3); // 2 apps + 1 pipeline

  await Deno.remove(path);
});

Deno.test("import-all: throws when the tracker file is missing (no writes)", async () => {
  const { context, writes } = fakeContext("/no/such/tracker-file.md");
  await assert.rejects(() => importAll({}, context));
  assert.equal(writes.length, 0);
});
