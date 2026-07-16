/**
 * Pure report logic for the pipeline-status report.
 *
 * Turns a pipeline snapshot (as written by the `@sntxrr/career-ops`
 * model) into a funnel roll-up plus career-ops-aware attention flags, and
 * renders it to markdown. No swamp/Deno dependency, so it is unit-testable.
 *
 * The snapshot records each application's *current* status, so the funnel is a
 * point-in-time distribution, not a historical cohort — a role rejected after
 * interviewing shows as `Rejected`, not under `Interview`. The rendered report
 * says so, to avoid over-reading the numbers.
 *
 * @module
 */
import { type Application } from "../models/tracker.ts";

/** Snapshot shape produced by the model's `pipeline` resource. */
export interface PipelineSnapshot {
  generatedAt: string;
  trackerPath: string;
  total: number;
  funnel: Record<string, number>;
  applications: Application[];
}

/** Canonical status order (mirrors career-ops' states.yml). */
export const CANON = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
  "Discarded",
  "SKIP",
] as const;

/** Statuses that mean an application was actually submitted. */
const SUBMITTED = new Set([
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
]);
/** Submitted and not yet closed out. */
const ACTIVE = new Set(["Applied", "Responded", "Interview", "Offer"]);
/** Terminal states. */
const CLOSED = new Set(["Hired", "Rejected", "Discarded"]);
/** career-ops' "recommend against applying below 4.0/5" bar (see CLAUDE.md). */
const FIT_BAR = 4.0;

/** A row surfaced by an attention flag. */
export interface FlaggedRow {
  num: number;
  company: string;
  role: string;
  score: string;
}

/** Structured report output (the report's `json`). */
export interface ReportData {
  generatedAt: string;
  total: number;
  submitted: number;
  active: number;
  closed: number;
  funnel: Array<{ status: string; count: number; pct: number }>;
  shareOfSubmitted: {
    respondedPlus: number;
    interviewPlus: number;
    offerPlus: number;
  };
  flags: {
    lowFitActive: FlaggedRow[];
    appliedNoPdf: FlaggedRow[];
  };
}

const pct = (
  n: number,
  d: number,
): number => (d > 0 ? Math.round((n / d) * 100) : 0);
const sum = (f: Record<string, number>, keys: Iterable<string>): number => {
  let t = 0;
  for (const k of keys) t += f[k] ?? 0;
  return t;
};

/** Compute the structured report data from a snapshot. */
export function buildReportData(snap: PipelineSnapshot): ReportData {
  const f = snap.funnel ?? {};
  const total = snap.total ?? (snap.applications?.length ?? 0);
  const submitted = sum(f, SUBMITTED);
  const active = sum(f, ACTIVE);
  const closed = sum(f, CLOSED);

  const respondedPlus = sum(f, ["Responded", "Interview", "Offer", "Hired"]);
  const interviewPlus = sum(f, ["Interview", "Offer", "Hired"]);
  const offerPlus = sum(f, ["Offer", "Hired"]);

  const funnel = CANON
    .filter((s) => (f[s] ?? 0) > 0)
    .map((s) => ({ status: s, count: f[s], pct: pct(f[s], total) }));

  const apps = snap.applications ?? [];
  const lowFitActive = apps
    .filter((a) =>
      ACTIVE.has(a.status) && a.scoreValue != null && a.scoreValue < FIT_BAR
    )
    .map((a) => ({
      num: a.num,
      company: a.company,
      role: a.role,
      score: a.score,
    }));
  const appliedNoPdf = apps
    .filter((a) => a.status === "Applied" && !a.pdf)
    .map((a) => ({
      num: a.num,
      company: a.company,
      role: a.role,
      score: a.score,
    }));

  return {
    generatedAt: snap.generatedAt,
    total,
    submitted,
    active,
    closed,
    funnel,
    shareOfSubmitted: {
      respondedPlus: pct(respondedPlus, submitted),
      interviewPlus: pct(interviewPlus, submitted),
      offerPlus: pct(offerPlus, submitted),
    },
    flags: { lowFitActive, appliedNoPdf },
  };
}

/** Render the report data to markdown. */
export function renderMarkdown(d: ReportData, trackerPath: string): string {
  const lines: string[] = [];
  lines.push("# Pipeline Status");
  lines.push("");
  lines.push(
    `_${trackerPath} · ${d.generatedAt} · ${d.total} applications_`,
  );
  lines.push("");

  lines.push("## Funnel (current status)");
  lines.push("");
  lines.push("| Stage | Count | Share |");
  lines.push("| --- | ---: | ---: |");
  for (const row of d.funnel) {
    lines.push(`| ${row.status} | ${row.count} | ${row.pct}% |`);
  }
  lines.push("");

  lines.push("## Roll-up");
  lines.push("");
  lines.push(
    `- **Submitted:** ${d.submitted} of ${d.total} (${
      pct(d.submitted, d.total)
    }%)`,
  );
  lines.push(`- **Active** (Applied–Offer): ${d.active}`);
  lines.push(`- **Closed** (Hired/Rejected/Discarded): ${d.closed}`);
  lines.push("");
  lines.push("Of submitted applications, current status is at or beyond:");
  lines.push(`- Responded+: **${d.shareOfSubmitted.respondedPlus}%**`);
  lines.push(`- Interview+: **${d.shareOfSubmitted.interviewPlus}%**`);
  lines.push(`- Offer+: **${d.shareOfSubmitted.offerPlus}%**`);
  lines.push("");
  lines.push(
    "_Current status only — a role rejected after interviewing counts under Rejected, not Interview._",
  );
  lines.push("");

  lines.push("## Attention");
  lines.push("");
  const { lowFitActive, appliedNoPdf } = d.flags;
  if (!lowFitActive.length && !appliedNoPdf.length) {
    lines.push("Nothing flagged.");
  } else {
    if (lowFitActive.length) {
      const list = lowFitActive
        .map((r) => `#${r.num} ${r.company} (${r.score})`)
        .join(", ");
      lines.push(
        `- ⚠️ **Active below the 4.0 fit bar** (${lowFitActive.length}): ${list}`,
      );
    }
    if (appliedNoPdf.length) {
      const list = appliedNoPdf.map((r) => `#${r.num} ${r.company}`).join(", ");
      lines.push(
        `- ⚠️ **Applied without a CV PDF** (${appliedNoPdf.length}): ${list}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
