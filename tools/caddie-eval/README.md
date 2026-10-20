# tools/caddie-eval

Local-only, consent-gated import of Caddie V2 evaluation clips. The full process, storage, and retention rules are in `docs/caddie-v2/VIDEO_IMPORT_AND_CONSENT.md`; the consent form is `docs/caddie-v2/consent/CONSENT_FORM_v1.html` (form version 1.1). Read those first.

- `import-clip.mjs`: `init`, `consent-add`, `import`, `status`, `verify`, `coach-check`, `third-party-check`, `withdraw`, `retention`. Usage is in the file header.
- Data lives in `GOLFME_EVAL_DATA_DIR` (default `~/golfme-eval-data`), never in this repo. The tool refuses a folder inside any git checkout or a cloud-sync folder.
- Consent records must be affirmative (signed form, adult, current form version) and keep clips at most **90 days**.
- **Third-party gate:** any future Roboflow/Gemini baseline runner must call `assertThirdPartyAllowed(dataDir, clipId, processor)` for every clip before sending it. It refuses unless the vendor is marked verified in `VENDOR_TERMS_VERIFIED` (both `null` today; see `docs/caddie-v2/VENDOR_VERIFICATION.md`) **and** the contributor ticked that processor's opt-in. Spend approval is a separate requirement.
- No network calls. No dependencies beyond Node. Optional `ffmpeg`/`ffprobe` on PATH (or `GOLFME_EVAL_FFMPEG` / `GOLFME_EVAL_FFPROBE`) strip and check audio and metadata.
- Tests: `node --test tools/caddie-eval/test/*.test.mjs` (temp folders and fake bytes only).
