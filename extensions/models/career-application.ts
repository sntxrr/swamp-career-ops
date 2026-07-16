/**
 * `@sntxrr/career-application` — models the career-ops job-application pipeline
 * as swamp data.
 *
 * A single model instance owns the whole pipeline. The `import-all` method reads
 * the career-ops applications tracker (`data/applications.md`) and writes one
 * versioned `application` resource per row plus a single `pipeline` aggregate
 * snapshot. Because each row is its own versioned resource, status changes over
 * time accumulate as history; because there is one aggregate resource, a
 * dashboard can read the entire pipeline in a single fetch.
 *
 * This is the markdown → swamp half of the bidirectional sync. The swamp →
 * markdown half (`set-status`) writes back through career-ops' canonical
 * `set-status.mjs`, added in a later method.
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

/** Resolve the tracker path from global arguments. */
function resolveTrackerPath(globalArgs: GlobalArgs): string {
  return globalArgs.trackerPath ??
    `${globalArgs.careerOpsDir}/data/applications.md`;
}

/** Model definition for the career-ops application pipeline. */
export const model = {
  type: "@sntxrr/career-application",
  version: "2026.07.16.1",
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
        context: {
          globalArgs: GlobalArgs;
          writeResource: (
            specName: string,
            name: string,
            data: Record<string, unknown>,
          ) => Promise<{ name: string }>;
          logger: {
            info: (msg: string, props?: Record<string, unknown>) => void;
          };
        },
      ): Promise<{ dataHandles: Array<{ name: string }> }> => {
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

        const funnel = computeFunnel(rows);
        handles.push(
          await context.writeResource("pipeline", "current", {
            generatedAt,
            trackerPath,
            total: rows.length,
            funnel,
            applications,
          }),
        );

        context.logger.info(
          "Imported {count} applications from {path}",
          { count: rows.length, path: trackerPath },
        );

        return { dataHandles: handles };
      },
    },
  },
};
