/**
 * Unit tests for the pipeline report core.
 *
 * @module
 */
import assert from "node:assert/strict";
import {
  buildReportData,
  type PipelineSnapshot,
  renderMarkdown,
} from "./pipeline-report-core.ts";

function app(over: Partial<PipelineSnapshot["applications"][number]>) {
  return {
    num: 1,
    date: "2026-07-01",
    company: "Acme",
    role: "Engineer",
    score: "4.5/5",
    scoreValue: 4.5,
    status: "Evaluated",
    pdf: true,
    reportNum: "001",
    reportPath: "reports/001.md",
    notes: "",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...over,
  };
}

const SNAP: PipelineSnapshot = {
  generatedAt: "2026-07-16T20:00:00.000Z",
  trackerPath: "/x/data/applications.md",
  total: 6,
  funnel: { Evaluated: 2, Applied: 2, Interview: 1, Rejected: 1 },
  applications: [
    app({
      num: 1,
      company: "Acme",
      status: "Applied",
      scoreValue: 4.2,
      score: "4.2/5",
      pdf: true,
    }),
    app({
      num: 2,
      company: "LowCo",
      status: "Applied",
      scoreValue: 3.1,
      score: "3.1/5",
      pdf: false,
    }),
    app({
      num: 3,
      company: "MidCo",
      status: "Interview",
      scoreValue: 4.6,
      score: "4.6/5",
      pdf: true,
    }),
    app({
      num: 4,
      company: "Nope",
      status: "Rejected",
      scoreValue: 2.0,
      score: "2.0/5",
      pdf: false,
    }),
    app({
      num: 5,
      company: "Eval1",
      status: "Evaluated",
      scoreValue: 3.5,
      score: "3.5/5",
      pdf: false,
    }),
    app({
      num: 6,
      company: "Eval2",
      status: "Evaluated",
      scoreValue: 4.9,
      score: "4.9/5",
      pdf: false,
    }),
  ],
};

Deno.test("buildReportData: roll-up counts", () => {
  const d = buildReportData(SNAP);
  assert.equal(d.total, 6);
  assert.equal(d.submitted, 4); // Applied 2 + Interview 1 + Rejected 1
  assert.equal(d.active, 3); //    Applied 2 + Interview 1
  assert.equal(d.closed, 1); //    Rejected 1
});

Deno.test("buildReportData: funnel skips zero stages, keeps canonical order", () => {
  const d = buildReportData(SNAP);
  assert.deepEqual(d.funnel.map((r) => r.status), [
    "Evaluated",
    "Applied",
    "Interview",
    "Rejected",
  ]);
  assert.equal(d.funnel[0].pct, 33); // 2/6
});

Deno.test("buildReportData: share-of-submitted", () => {
  const d = buildReportData(SNAP);
  // submitted = 4; interview+ = Interview 1 → 25%; responded+ = 25%; offer+ = 0
  assert.equal(d.shareOfSubmitted.respondedPlus, 25);
  assert.equal(d.shareOfSubmitted.interviewPlus, 25);
  assert.equal(d.shareOfSubmitted.offerPlus, 0);
});

Deno.test("buildReportData: low-fit active flag (score < 4.0, active only)", () => {
  const d = buildReportData(SNAP);
  // Only #2 LowCo (3.1, Applied). #4 Nope is 2.0 but Rejected (not active).
  assert.deepEqual(d.flags.lowFitActive.map((r) => r.num), [2]);
});

Deno.test("buildReportData: applied-without-pdf flag", () => {
  const d = buildReportData(SNAP);
  // #2 LowCo is Applied and pdf=false. #1 Acme is Applied but pdf=true.
  assert.deepEqual(d.flags.appliedNoPdf.map((r) => r.num), [2]);
});

Deno.test("renderMarkdown: includes funnel table and snapshot caveat", () => {
  const md = renderMarkdown(buildReportData(SNAP), SNAP.trackerPath);
  assert.match(md, /# Pipeline Status/);
  assert.match(md, /\| Stage \| Count \| Share \|/);
  assert.match(md, /Current status only/);
  assert.match(md, /below the 4\.0 fit bar/);
});

function mkApp(over: Record<string, unknown>) {
  return {
    num: 1,
    date: "2026-07-01",
    company: "Co",
    role: "Eng",
    score: "4.5/5",
    scoreValue: 4.5,
    status: "Applied",
    pdf: true,
    reportNum: "001",
    reportPath: "reports/001.md",
    notes: "",
    url: "",
    legitimacy: "High Confidence",
    updatedAt: "2026-07-16T20:00:00.000Z",
    ...over,
  };
}

Deno.test("buildReportData: flags active postings below High Confidence", () => {
  const snap = {
    generatedAt: "2026-07-16T20:00:00.000Z",
    trackerPath: "/x",
    total: 3,
    funnel: { Applied: 2, Evaluated: 1 },
    applications: [
      mkApp({
        num: 1,
        company: "Cautious",
        legitimacy: "Proceed with Caution",
      }),
      mkApp({ num: 2, company: "Clean", legitimacy: "High Confidence" }),
      // Suspicious but only Evaluated (not active) → not flagged.
      mkApp({
        num: 3,
        company: "Sus",
        status: "Evaluated",
        legitimacy: "Suspicious",
      }),
    ],
  };
  const d = buildReportData(snap);
  assert.deepEqual(d.flags.legitimacyConcern.map((r) => r.num), [1]);
  assert.equal(d.flags.legitimacyConcern[0].legitimacy, "Proceed with Caution");
});

Deno.test("buildReportData: empty pipeline is safe", () => {
  const d = buildReportData({
    generatedAt: "2026-07-16T00:00:00.000Z",
    trackerPath: "/x",
    total: 0,
    funnel: {},
    applications: [],
  });
  assert.equal(d.submitted, 0);
  assert.equal(d.funnel.length, 0);
  assert.equal(d.shareOfSubmitted.offerPlus, 0);
});
