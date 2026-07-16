/**
 * Execute-path tests for the pipeline-status report, using a fake report
 * context whose `dataRepository.getContent` returns a canned snapshot. Covers
 * the success path (renders funnel + json) and the empty path (no stored data).
 *
 * @module
 */
import assert from "node:assert/strict";
import { report } from "./pipeline-status.ts";

const SNAP = {
  generatedAt: "2026-07-16T20:00:00.000Z",
  trackerPath: "/x/data/applications.md",
  total: 3,
  funnel: { Evaluated: 1, Applied: 2 },
  applications: [
    {
      num: 1,
      date: "2026-07-01",
      company: "Acme",
      role: "Eng",
      score: "4.2/5",
      scoreValue: 4.2,
      status: "Applied",
      pdf: true,
      reportNum: "001",
      reportPath: "reports/001.md",
      notes: "",
      updatedAt: "2026-07-16T20:00:00.000Z",
    },
  ],
};

function fakeContext(content: Uint8Array | null) {
  return {
    modelType: "@sntxrr/career-ops",
    modelId: "model-123",
    dataRepository: {
      getContent: (_t: string, _m: string, name: string) => {
        return Promise.resolve(name === "current" ? content : null);
      },
    },
  };
}

Deno.test("report: renders funnel and json from a stored snapshot", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(SNAP));
  const out = await report.execute(fakeContext(bytes));
  assert.match(out.markdown, /# Pipeline Status/);
  assert.match(out.markdown, /\| Evaluated \| 1 \|/);
  assert.match(out.markdown, /\| Applied \| 2 \|/);
  assert.equal(out.json.total, 3);
  assert.equal(out.json.submitted, 2);
});

Deno.test("report: returns the empty report when no snapshot is stored", async () => {
  const out = await report.execute(fakeContext(null));
  assert.match(out.markdown, /No pipeline snapshot found/);
  assert.equal(out.json.empty, true);
});

Deno.test("report: returns the empty report on unparseable content", async () => {
  const bytes = new TextEncoder().encode("not json{");
  const out = await report.execute(fakeContext(bytes));
  assert.equal(out.json.empty, true);
});
