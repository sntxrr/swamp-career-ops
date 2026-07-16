# @sntxrr/career-ops

A [swamp](https://swamp-club.com) extension that models the
[career-ops](https://github.com/santifer/career-ops) job-application pipeline as
swamp data, so application status can be queried, versioned, and surfaced in a
dashboard.

## What it does

career-ops tracks job applications in a markdown table
(`data/applications.md`). This extension mirrors that tracker into swamp:

- **`@sntxrr/career-application`** — a factory model. One model instance owns the
  whole pipeline. Its `import-all` method reads the tracker and writes:
  - one versioned **`application`** resource per row (`app-001`, `app-002`, …),
    so status changes accumulate as history over time; and
  - one **`pipeline`** aggregate resource (`current`) holding the full row set
    plus a status funnel — a single fetch for dashboards.

This is the **markdown → swamp** half of a bidirectional sync. The
**swamp → markdown** half (a `set-status` method that writes back through
career-ops' canonical `set-status.mjs`) and a `pipeline-status` report are on the
roadmap.

## Usage

Point the model at your career-ops checkout and import:

```bash
swamp model @sntxrr/career-application method run import-all pipeline \
  --input careerOpsDir=/absolute/path/to/career-ops
```

Read the aggregate snapshot back:

```bash
swamp data get pipeline current --json
```

By default the tracker is read from `<careerOpsDir>/data/applications.md`;
override with `--input trackerPath=/some/other/tracker.md`.

### Global arguments

| Argument       | Required | Description                                                          |
| -------------- | -------- | -------------------------------------------------------------------- |
| `careerOpsDir` | yes      | Absolute path to the career-ops repository root.                     |
| `trackerPath`  | no       | Override the tracker file path (defaults to `<dir>/data/applications.md`). |

## Development

```bash
deno check extensions/models/career-application.ts extensions/models/tracker.ts
deno test --allow-read extensions/models/tracker_test.ts
```

(Use the swamp-bundled Deno at `~/.swamp/deno/deno` if Deno isn't on your PATH.)

## Web dashboard

A dependency-free dashboard reads the swamp snapshot and renders the funnel plus
a sortable, filterable application table (light/dark aware):

```bash
node webui/server.mjs           # → http://localhost:8787
```

The server shells `swamp data get pipeline current --json` for `GET /api/pipeline`
and re-runs `import-all` for `POST /api/refresh` (the Refresh button). Configure
with `PORT`, `SWAMP_BIN`, and `CAREER_OPS_DIR` env vars.

## Roadmap

- [x] `import-all` — markdown → swamp
- [x] Web dashboard reading the swamp JSON (funnel + table, `webui/`)
- [ ] `set-status` — swamp → markdown via career-ops `set-status.mjs`
- [ ] `pipeline-status` report (funnel, conversion, attention flags)
- [ ] Publish to the swamp registry

## License

MIT — see [LICENSE](LICENSE).
