# tools/caddie-eval

Local-only, consent-gated import of Caddie V2 evaluation clips. The full process, consent text, and retention rules are in `docs/caddie-v2/VIDEO_IMPORT_AND_CONSENT.md`. Read that first.

- `import-clip.mjs`: `init`, `consent-add`, `import`, `status`, `verify`, `withdraw`, `retention`. Usage is in the file header.
- Data lives in `GOLFME_EVAL_DATA_DIR` (default `~/golfme-eval-data`), never in this repo. The tool refuses a folder inside any git checkout or a cloud-sync folder.
- No network calls. No dependencies beyond Node. Optional `ffmpeg`/`ffprobe` on PATH (or `GOLFME_EVAL_FFMPEG` / `GOLFME_EVAL_FFPROBE`) strip and check audio and metadata.
- Tests: `node --test tools/caddie-eval/test/*.test.mjs` (temp folders and fake bytes only).
