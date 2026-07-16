/**
 * Unit tests for the tracker parser.
 *
 * @module
 */
import assert from "node:assert/strict";
import { computeFunnel, padNum, parseTracker } from "./tracker.ts";

const SAMPLE = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 17 | 2026-07-16 | Google | Senior DevRel Engineer | 2.8/5 | Evaluated | ❌ | [017](../reports/017-google-2026-07-16.md) | Pass; pursue remote |
| 6 | 2026-07-09 | Vercel | Security Engineer, Cloud | 4.6/5 | Applied | ✅ | [006](../reports/006-vercel-cloud-2026-07-09.md) | Applied 2026-07-16 |
| 1 | 2026-06-24 | MongoDB | Security Software Engineer | 4.2/5 | Applied | ✅ | [001](../reports/001-mongodb-2026-06-24.md) | Remote confirmed |
`;

Deno.test("parseTracker: parses well-formed rows", () => {
  const apps = parseTracker(SAMPLE);
  assert.equal(apps.length, 3);
  const google = apps[0];
  assert.equal(google.num, 17);
  assert.equal(google.date, "2026-07-16");
  assert.equal(google.company, "Google");
  assert.equal(google.role, "Senior DevRel Engineer");
  assert.equal(google.score, "2.8/5");
  assert.equal(google.scoreValue, 2.8);
  assert.equal(google.status, "Evaluated");
  assert.equal(google.pdf, false);
});

Deno.test("parseTracker: extracts report number and strips ../ from path", () => {
  const [google] = parseTracker(SAMPLE);
  assert.equal(google.reportNum, "017");
  assert.equal(google.reportPath, "reports/017-google-2026-07-16.md");
});

Deno.test("parseTracker: pdf flag reflects the check-mark column", () => {
  const apps = parseTracker(SAMPLE);
  assert.equal(apps[0].pdf, false); // ❌
  assert.equal(apps[1].pdf, true); // ✅
});

Deno.test("parseTracker: skips header and separator rows", () => {
  const apps = parseTracker(SAMPLE);
  // Only three real data rows; the "#" header and "|---|" separator are dropped.
  assert.deepEqual(apps.map((a) => a.num), [17, 6, 1]);
});

Deno.test("parseTracker: unparseable score becomes null", () => {
  const md = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|
| 2 | 2026-01-01 | Acme | Engineer | TBD | Evaluated | ❌ | [002](reports/x.md) | pending |`;
  const [row] = parseTracker(md);
  assert.equal(row.scoreValue, null);
  assert.equal(row.score, "TBD");
});

Deno.test("parseTracker: notes containing a pipe are preserved", () => {
  const md = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|
| 3 | 2026-01-02 | Beta | Dev | 3.0/5 | Applied | ✅ | [003](reports/y.md) | remote | onsite optional |`;
  const [row] = parseTracker(md);
  assert.equal(row.notes, "remote | onsite optional");
});

Deno.test("computeFunnel: counts by status", () => {
  const funnel = computeFunnel(parseTracker(SAMPLE));
  assert.deepEqual(funnel, { Evaluated: 1, Applied: 2 });
});

Deno.test("padNum: zero-pads to three digits", () => {
  assert.equal(padNum(1), "001");
  assert.equal(padNum(17), "017");
  assert.equal(padNum(123), "123");
});
