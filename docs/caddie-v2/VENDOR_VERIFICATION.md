# Caddie V2: vendor verification before any third-party baseline

Status: **draft, 2026-10-20. Nothing in this file is verified.** Micky completes the checklists below in the vendors' dashboards and terms. Until he does, **no evaluation clip may be sent to Roboflow or Gemini**, and the import tool enforces that.

## 1. Why this exists

Running today's Caddie (V1) over the evaluation clips, as a baseline to compare against coach labels, means sending those clips to two outside companies. That is allowed only when **all three** hold:

1. **Vendor terms verified** for that processor (this file, section 4 or 5, every box ticked and dated by Micky).
2. **The contributor opted in to that processor** on the signed consent form (form v1.1, section 9: a separate tick for Roboflow and for Gemini). The tool records these as `thirdPartyRoboflow` and `thirdPartyGemini`.
3. **Micky's spend approval** for the run (`CADDIE_V2_AUDIT.md` §11, "Approval needed vs not").

The tool can check 1 and 2; 3 is on trust.

## 2. How the tool enforces it

- `tools/caddie-eval/import-clip.mjs` exports `VENDOR_TERMS_VERIFIED`, frozen at `{ roboflow: null, gemini: null }`. `null` means not verified.
- `assertThirdPartyAllowed(dataDir, clipId, processor)` is **the** gate. It throws unless the processor is verified, the clip is in the manifest, its contributor's consent is active and affirmative, the contributor ticked that processor, and the clip's audio and metadata were stripped. **Any future baseline runner must call it for every clip before sending anything**, and must not cache its result across runs (a withdrawal or expiry must take effect immediately).
- `node tools/caddie-eval/import-clip.mjs third-party-check --processor roboflow|gemini` lists eligible clips and the refusal reason for the rest. It exits 1 while the vendor is unverified.
- Tests in `tools/caddie-eval/test/import-clip.test.mjs` ("third-party gate") pin this behaviour: shipped state refuses everything; a contributor without the tick is refused even when the vendor is verified.

**To mark a vendor verified:** after every box in its section is ticked, change that vendor's entry to `{ verifiedOn: "YYYY-MM-DD", by: "Micky", checklist: "docs/caddie-v2/VENDOR_VERIFICATION.md" }` in a commit of its own, and fill in the "Verified" line of the section. If terms change later (section 6), set it back to `null`.

## 3. What "verified" must cover, for each vendor

| Item | Question to answer | Why it matters for the consent form |
|---|---|---|
| Plan / tier | Which plan or tier is the account actually on, and which terms apply to it? | Free and paid tiers often have different data terms |
| Training use | Can the vendor use our inputs (frames, videos, prompts) or outputs to train or improve models? Is it opt-out, off by default, or not allowed? | The form promises the videos are not used to train a model |
| Human review | Can vendor staff look at inputs? | Faces are visible |
| Data retention | How long are inputs and outputs kept (including logs, caches, uploaded files), and can that be shortened? | The form promises 90-day maximum retention and deletion on withdrawal |
| Deletion | Can we delete a specific input on request, and is it then deleted from backups/archives? How long does it take? | Withdrawal within 7 days |
| Region | Where is data processed and stored? Any transfer mechanism (e.g. Standard Contractual Clauses)? | Contributors may be in different countries |
| Subprocessors | Who else receives the data (cloud host, etc.)? Where is the list? | Disclosure |
| Processor terms | Is there a Data Processing Addendum (DPA) and does it apply to this account automatically? | Defines the vendor as processor, not owner |
| Public / sharing settings | Could the data become visible to others (public projects, sharing defaults)? | The form promises no public posting |

## 4. Google Gemini (Gemini API, Google AI Studio)

**Known from Micky (2026-10-20):** the billing account is on **paid Tier 1, prepaid credits** (`CADDIE_V2_AUDIT.md` §12 Q1). Not yet confirmed: that the API key Caddie uses belongs to a project on that paid billing account.

**What the public pages appear to say** (read 2026-10-20 by the assistant; **to be confirmed by Micky**, not verified, and terms change):

- Gemini API Additional Terms, <https://ai.google.dev/gemini-api/terms> (page shows "effective March 23, 2026", last updated 2026-04-28): for **Paid Services**, Google appears to say it doesn't use prompts or responses to improve its products, and processes them under its data processor terms; it logs prompts and responses "for a limited period of time" for abuse detection and legal requirements (no duration given on that page); data "may be stored transiently or cached in any country". For **Unpaid Services**, content may be used to improve products and may be read by human reviewers. Grounding with Google Search/Maps stores data for 30 days.
- Files API, <https://ai.google.dev/gemini-api/docs/files>: uploaded files appear to be stored for 48 hours and can be deleted manually.
- Data retention / zero data retention page, <https://ai.google.dev/gemini-api/docs/zdr>: appears to say guaranteed zero data retention needs Vertex AI; on the Gemini API, Files API uploads stay until deleted or expired, and implicit in-memory caching keeps data up to 24 hours.
- Data processor terms (referenced by the terms above): <https://business.safety.google/processorterms/> and subprocessors: <https://business.safety.google/subprocessors/> (**not read by the assistant**; Micky to open).

**Checklist (Micky):**

- [ ] AI Studio / Cloud console: the API key Caddie uses (and any key a baseline runner would use) is in a project on the **paid Tier 1** billing account, not free quota. Record the project name (not the key).
- [ ] The Paid Services section of the Gemini API Additional Terms still says prompts/responses are not used to improve products. Record the "last updated" date you read.
- [ ] Abuse-monitoring log retention: find the stated period (if any) for paid use. If none is stated, write "not stated" and decide whether that is acceptable against the 90-day promise.
- [ ] Human review: confirm whether paid-tier inputs can be human-reviewed (the terms page mentions human review only for unpaid services; confirm).
- [ ] Files API: confirm 48-hour automatic deletion, and that the baseline runner deletes each uploaded file right after use (V1 deletion is fire-and-forget with errors ignored, audit P3; a runner must check the delete result).
- [ ] No Grounding with Google Search/Maps, no context caching, no stored Interactions state in the baseline call (each adds retention).
- [ ] Region: note where data may be processed ("any country" per the terms) and whether that is acceptable for the contributors.
- [ ] DPA: confirm the processor terms apply to this account (accepted automatically or needs acceptance in the console).
- [ ] Subprocessors list opened and noted.
- [ ] Clips sent are stripped of audio (V1 sends trimmed copies **with** audio, audit P3; the baseline runner must send the stripped clip from the data folder, not re-trim the original).

Verified: ____-__-__ by ______ (leave blank until every box is ticked).

## 5. Roboflow (hosted workflow inference)

**Known:** plan **unknown** (`CADDIE_V2_AUDIT.md` §12 Q2 and Q3). V1 sends full-resolution still frames to a hosted Roboflow workflow (audit P4). Whether that workflow stores images, or contains dataset / active-learning blocks, is unknown.

**What the public pages appear to say** (read 2026-10-20 by the assistant; **to be confirmed by Micky**, not verified):

- Terms of Service, <https://roboflow.com/terms> (last updated May 3, 2024 per the page): content in **public projects** or on the **Public (free) plan** gets a broad, perpetual licence and can be visible to other users; Public plan use is limited to internal, non-commercial use. For **private projects (Starter plan and higher)**, the licence appears limited to providing the service and internal business purposes, which the page describes as including "internal research, optimization, training and improving the Services". On removal requests Roboflow says it "may retain the User Content in non-public archives". The terms page doesn't appear to address inference inputs specifically, and doesn't mention a DPA or subprocessor list.
- Privacy Policy, <https://roboflow.com/privacy> (last modified June 1, 2025): retention "for so long as it needs to be kept for legitimate business or legal purposes"; data may be processed inside and outside the United States, with Standard Contractual Clauses for transfers; deletion on request; backups may take time to clear. It doesn't appear to say whether inference images are stored or used for training.
- Trust center, <https://security.roboflow.com/>: lists SOC 2 (report behind a request) and AWS infrastructure; no DPA, subprocessor list, or inference-image retention visible on the public page.

**Reading these together (to confirm):** the public terms do **not** clearly rule out Roboflow using private-project data to improve its services, and say nothing specific about inference images. That may conflict with the form's promise that videos are not used to train a model. Roboflow may need to be asked directly, or the baseline may need a different pose source.

**Checklist (Micky):**

- [ ] Roboflow dashboard: which **plan** is the workspace on (Public/free, Starter, Growth, Enterprise)? If Public/free, **stop**: public-plan terms are incompatible with the consent form.
- [ ] The workflow Caddie uses: confirm it has **no** dataset-upload, active-learning, or "save image" blocks, and note whether inference images are stored anywhere in the workspace (e.g. a "Model Monitoring" or inference-history feature). Record the workflow's version.
- [ ] Is the workspace and its projects **private**?
- [ ] Training / improvement use of **inference inputs**: find a written answer (docs, DPA, or support reply). The terms' "training and improving the Services" wording for private projects needs an explicit answer for inference images. Save the answer (no keys or account IDs in the repo).
- [ ] Retention of inference inputs and logs: period, and whether it can be set to zero.
- [ ] Deletion: can specific inference inputs be deleted on request; what about the "non-public archives" wording?
- [ ] DPA: is one available for this plan? Subprocessors list?
- [ ] Region: where inference runs and data is stored.
- [ ] Remove the workflow's visualization output for the baseline run if possible (audit §12 Q3), so annotated images aren't produced or stored.

Verified: ____-__-__ by ______ (leave blank until every box is ticked).

## 6. When to re-check

- Before the first baseline run, and again before any later run more than 30 days after the last check.
- Whenever Micky changes plan, project, API key, or workflow.
- If a vendor's terms page shows a newer "last updated" date than the one recorded above, set that vendor back to `null` in `VENDOR_TERMS_VERIFIED` until re-checked.

## 7. If the terms don't fit the consent form

Don't send clips. Options, each a decision for Micky: ask the vendor for a written commitment; change plan; use a local pose source for the baseline (e.g. an on-device or locally run model) and skip that vendor; or revise the form (new version, re-consent). Never send under the current form if the vendor's terms would break a promise the form makes.
