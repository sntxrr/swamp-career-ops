/**
 * `@sntxrr/career-application` — models the career-ops job-application pipeline
 * as swamp data.
 *
 * A single model instance owns the whole pipeline:
 *
 * - **`import-all`** reads the career-ops applications tracker
 *   (`data/applications.md`) and mirrors every row into swamp — one versioned
 *   `application` resource per row plus one `pipeline` aggregate snapshot
 *   (markdown → swamp).
 * - **`set-status`** changes one row's status/note by shelling out to
 *   career-ops' canonical `set-status.mjs` writer, then re-mirrors so the swamp
 *   snapshot matches the freshly-written tracker (swamp → markdown → swamp).
 *
 * The markdown tracker is always the single source of truth: every write funnels
 * through `set-status.mjs` into the file, then the file is re-mirrored, so the
 * swamp snapshot can never hold an authoritative edit that disagrees with it.
 *
 * @module
 */
import { z } from "npm:zod@4";
import {
  type Application,
  computeFunnel,
  padNum,
  parseTracker,
} from "./tracker.ts";

/** Global arguments: where the career-ops repo and its tracker live. */
const GlobalArgsSchema = z.object({
  careerOpsDir: z.string().describe(
    "Absolute path to the career-ops repository root.",
  ),
  trackerPath: z.string().optional().describe(
    "Override the tracker file path. Defaults to <careerOpsDir>/data/applications.md.",
  ),
});

type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

/** One application row, mirrored from the tracker. */
const ApplicationSchema = z.object({
  num: z.number(),
  date: z.string(),
  company: z.string(),
  role: z.string(),
  score: z.string(),
  scoreValue: z.number().nullable(),
  status: z.string(),
  pdf: z.boolean(),
  reportNum: z.string(),
  reportPath: z.string(),
  notes: z.string(),
  updatedAt: z.iso.datetime(),
});

/** Aggregate snapshot of the whole pipeline. */
const PipelineSchema = z.object({
  generatedAt: z.iso.datetime(),
  trackerPath: z.string(),
  total: z.number(),
  funnel: z.record(z.string(), z.number()),
  applications: z.array(ApplicationSchema),
});

/** Arguments for the set-status method. */
const SetStatusArgsSchema = z.object({
  selector: z.union([z.string(), z.number()]).describe(
    "Row selector: tracker # (exact) or company name (normalized match).",
  ),
  status: z.string().describe(
    "New canonical status (Evaluated, Applied, Responded, Interview, Offer, Rejected, Discarded, SKIP, Hired).",
  ),
  note: z.string().optional().describe("Note appended to the row's Notes cell."),
  role: z.string().optional().describe(
    "Role hint to disambiguate when a company has multiple rows.",
  ),
  dryRun: z.boolean().optional().describe(
    "Validate and resolve the row without writing the tracker.",
  ),
});

type SetStatusArgs = z.infer<typeof SetStatusArgsSchema>;

/** Minimal shape of the context fields the methods use. */
interface MethodContext {
  globalArgs: GlobalArgs;
  writeResource: (
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<{ name: string }>;
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
  };
}

/** Resolve the tracker path from global arguments. */
function resolveTrackerPath(globalArgs: GlobalArgs): string {
  return globalArgs.trackerPath ??
    `${globalArgs.careerOpsDir}/data/applications.md`;
}

/** Resolve the career-ops repo dir from global args, else from the tracker path. */
function resolveCareerOpsDir(globalArgs: GlobalArgs): string {
  if (globalArgs.careerOpsDir) return globalArgs.careerOpsDir;
  return resolveTrackerPath(globalArgs).replace(
    /\/data\/applications\.md$/,
    "",
  );
}

/**
 * Read the tracker and mirror every row into swamp: one `application` resource
 * per row plus the `pipeline` aggregate. Shared by both methods.
 */
async function mirrorTracker(
  context: MethodContext,
): Promise<Array<{ name: string }>> {
  const trackerPath = resolveTrackerPath(context.globalArgs);
  const markdown = await Deno.readTextFile(trackerPath);
  const rows: Application[] = parseTracker(markdown);
  const generatedAt = new Date().toISOString();

  const handles: Array<{ name: string }> = [];
  const applications: Array<z.infer<typeof ApplicationSchema>> = [];

  for (const row of rows) {
    const record = { ...row, updatedAt: generatedAt };
    applications.push(record);
    handles.push(
      await context.writeResource(
        "application",
        `app-${padNum(row.num)}`,
        record,
      ),
    );
  }

  handles.push(
    await context.writeResource("pipeline", "current", {
      generatedAt,
      trackerPath,
      total: rows.length,
      funnel: computeFunnel(rows),
      applications,
    }),
  );

  context.logger.info("Mirrored {count} applications from {path}", {
    count: rows.length,
    path: trackerPath,
  });
  return handles;
}

/**
 * Run career-ops' canonical `set-status.mjs` writer as a subprocess. Returns the
 * parsed `--json` payload on success; throws with the writer's own diagnostics
 * (and exit code) on any non-zero exit.
 */
async function runSetStatus(
  careerOpsDir: string,
  args: SetStatusArgs,
): Promise<Record<string, unknown>> {
  const cmdArgs = [
    "set-status.mjs",
    String(args.selector),
    args.status,
  ];
  if (args.note) cmdArgs.push("--note", args.note);
  if (args.role) cmdArgs.push("--role", args.role);
  if (args.dryRun) cmdArgs.push("--dry-run");
  cmdArgs.push("--json");

  const command = new Deno.Command("node", {
    args: cmdArgs,
    cwd: careerOpsDir,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  const out = new TextDecoder().decode(stdout).trim();
  const err = new TextDecoder().decode(stderr).trim();

  if (code !== 0) {
    throw new Error(
      `set-status.mjs exited ${code}: ${err || out || "unknown error"}`,
    );
  }
  try {
    return out ? JSON.parse(out) : {};
  } catch {
    return { raw: out };
  }
}

/** Model definition for the career-ops application pipeline. */
export const model = {
  type: "@sntxrr/career-application",
  version: "2026.07.16.2",
  globalArguments: GlobalArgsSchema,
  resources: {
    "application": {
      description: "A single application row mirrored from the tracker.",
      schema: ApplicationSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "pipeline": {
      description: "Aggregate snapshot of the whole pipeline (funnel + rows).",
      schema: PipelineSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
  },
  methods: {
    "import-all": {
      description:
        "Read the career-ops tracker and mirror every row into swamp (markdown → swamp).",
      arguments: z.object({}),
      execute: async (
        _args: Record<string, never>,
        context: MethodContext,
      ): Promise<{ dataHandles: Array<{ name: string }> }> => {
        return { dataHandles: await mirrorTracker(context) };
      },
    },
    "set-status": {
      description:
        "Change one row's status/note via career-ops' set-status.mjs, then re-mirror (swamp → markdown → swamp).",
      arguments: SetStatusArgsSchema,
      execute: async (
        args: SetStatusArgs,
        context: MethodContext,
      ): Promise<{ dataHandles: Array<{ name: string }> }> => {
        const careerOpsDir = resolveCareerOpsDir(context.globalArgs);
        const result = await runSetStatus(careerOpsDir, args);
        context.logger.info(
          "set-status {selector} → {status}{dry}",
          {
            selector: String(args.selector),
            status: args.status,
            dry: args.dryRun ? " (dry-run)" : "",
          },
        );
        // Dry runs never wrote the tracker, so there is nothing new to mirror.
        if (args.dryRun) return { dataHandles: [] };
        return { dataHandles: await mirrorTracker(context) };
      },
    },
  },
};
