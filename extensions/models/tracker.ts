/**
 * Pure parsing helpers for the career-ops applications tracker
 * (`data/applications.md`).
 *
 * The tracker is a GitHub-flavoured markdown table with a fixed nine-column
 * layout: `# | Date | Company | Role | Score | Status | PDF | Report | Notes`.
 * These functions turn that table into structured records and a status funnel.
 * They are deliberately free of any swamp or Deno dependency so they can be
 * unit-tested in isolation.
 *
 * @module
 */

/** One parsed application row from the tracker. */
export interface Application {
  /** Sequential tracker number (the `#` column). */
  num: number;
  /** Date the row was created, `YYYY-MM-DD`. */
  date: string;
  /** Short company name. */
  company: string;
  /** Job title. */
  role: string;
  /** Raw score cell, e.g. `"4.2/5"` (empty string when absent). */
  score: string;
  /** Numeric score parsed from `score`, or `null` when unparseable. */
  scoreValue: number | null;
  /** Canonical status label (e.g. `"Applied"`). */
  status: string;
  /** Whether a CV PDF exists (the `✅`/`❌` column). */
  pdf: boolean;
  /** Zero-padded report number extracted from the Report link (e.g. `"017"`). */
  reportNum: string;
  /** Report path with any leading `../` stripped (e.g. `"reports/017-...md"`). */
  reportPath: string;
  /** Free-text notes cell. */
  notes: string;
}

/** Aggregate funnel counts keyed by canonical status label. */
export type Funnel = Record<string, number>;

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/;

/**
 * Split a single markdown table row into trimmed cells, tolerating pipes that
 * appear inside the trailing Notes cell by collapsing any overflow columns back
 * into the last field.
 */
function splitRow(line: string, fixedCols: number): string[] {
  let parts = line.split("|");
  if (parts.length > 0 && parts[0].trim() === "") parts = parts.slice(1);
  if (parts.length > 0 && parts[parts.length - 1].trim() === "") {
    parts = parts.slice(0, -1);
  }
  if (parts.length > fixedCols) {
    const head = parts.slice(0, fixedCols - 1).map((c) => c.trim());
    const tail = parts.slice(fixedCols - 1).join("|").trim();
    return [...head, tail];
  }
  return parts.map((c) => c.trim());
}

/**
 * Parse the applications tracker markdown into structured rows.
 *
 * Header and separator lines, blank lines, and any row whose first cell is not
 * an integer are skipped, so malformed or non-data lines never produce records.
 */
export function parseTracker(markdown: string): Application[] {
  const apps: Application[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    // Skip the separator row (|---|---|...).
    if (/^\|[\s:|-]+\|?$/.test(line)) continue;
    const cells = splitRow(line, 9);
    if (cells.length < 9) continue;
    const num = Number.parseInt(cells[0], 10);
    if (!Number.isInteger(num)) continue; // header row ("#") lands here too

    const scoreRaw = cells[4];
    const scoreNum = Number.parseFloat(scoreRaw);
    const linkMatch = cells[7].match(LINK_RE);
    const reportNum = linkMatch ? linkMatch[1] : "";
    const reportPath = linkMatch ? linkMatch[2].replace(/^(\.\.\/)+/, "") : "";

    apps.push({
      num,
      date: cells[1],
      company: cells[2],
      role: cells[3],
      score: scoreRaw,
      scoreValue: Number.isFinite(scoreNum) ? scoreNum : null,
      status: cells[5],
      pdf: cells[6].includes("✅"),
      reportNum,
      reportPath,
      notes: cells[8],
    });
  }
  return apps;
}

/** Count applications by canonical status label. */
export function computeFunnel(apps: Application[]): Funnel {
  const funnel: Funnel = {};
  for (const app of apps) {
    const key = app.status || "Unknown";
    funnel[key] = (funnel[key] ?? 0) + 1;
  }
  return funnel;
}

/** Zero-pad a tracker number to three digits for use as a resource instance name. */
export function padNum(num: number): string {
  return String(num).padStart(3, "0");
}

/** Metadata parsed from an evaluation report's header. */
export interface ReportMeta {
  /** The job posting URL (`**URL:**` line), or empty string when absent. */
  url: string;
  /** The posting legitimacy tier (`**Legitimacy:**` line), or empty string. */
  legitimacy: string;
}

const URL_RE = /^\s*\*\*URL:\*\*\s*(.+?)\s*$/im;
const LEGIT_RE = /^\s*\*\*Legitimacy:\*\*\s*(.+?)\s*$/im;

/**
 * Parse the `**URL:**` and `**Legitimacy:**` header lines from an evaluation
 * report's markdown. Missing lines yield empty strings, so a report without the
 * header (or content that isn't a report) is handled gracefully.
 */
export function parseReportMeta(markdown: string): ReportMeta {
  const u = markdown.match(URL_RE);
  const l = markdown.match(LEGIT_RE);
  return {
    url: u ? u[1].trim() : "",
    legitimacy: l ? l[1].trim() : "",
  };
}
