/**
 * `@sntxrr/pipeline-status` — a swamp report over the career-ops pipeline.
 *
 * Runs after a `@sntxrr/career-ops` method executes, reads the latest
 * `pipeline` aggregate the model stored, and produces a funnel roll-up plus
 * attention flags as markdown + JSON. View with:
 *
 *   swamp report get @sntxrr/career-ops-pipeline-status --model pipeline --json
 *
 * @module
 */
import {
  buildReportData,
  type PipelineSnapshot,
  renderMarkdown,
} from "./pipeline-report-core.ts";

const EMPTY = {
  markdown:
    "# Pipeline Status\n\nNo pipeline snapshot found. Run `import-all` first.\n",
  json: { empty: true },
};

/** Report definition. */
export const report = {
  name: "@sntxrr/career-ops-pipeline-status",
  description:
    "Funnel roll-up and attention flags for the career-ops application pipeline.",
  scope: "method",
  labels: ["career-ops", "pipeline"],
  execute: async (
    context: {
      modelType: string;
      modelId: string;
      dataRepository: {
        getContent: (
          type: string,
          modelId: string,
          dataName: string,
          version?: number,
        ) => Promise<Uint8Array | null>;
      };
    },
  ): Promise<{ markdown: string; json: Record<string, unknown> }> => {
    const raw = await context.dataRepository.getContent(
      context.modelType,
      context.modelId,
      "current",
    );
    if (!raw) return EMPTY;

    let snap: PipelineSnapshot;
    try {
      snap = JSON.parse(new TextDecoder().decode(raw)) as PipelineSnapshot;
    } catch {
      return EMPTY;
    }
    if (!snap || !snap.funnel) return EMPTY;

    const data = buildReportData(snap);
    return {
      markdown: renderMarkdown(data, snap.trackerPath ?? "tracker"),
      json: data as unknown as Record<string, unknown>,
    };
  },
};
