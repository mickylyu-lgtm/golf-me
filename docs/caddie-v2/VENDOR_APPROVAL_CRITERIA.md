# Caddie V2: vendor approval criteria

Status: **draft, 2026-10-20. No vendor has passed.** This file sets the pass/fail bar a third-party processor must clear before **any** participant clip, still frame, or data derived from one is sent to it. `VENDOR_VERIFICATION.md` holds the per-vendor evidence and checklists; this file is the rule those checklists are judged against.

Not legal advice. These criteria are written to keep the promises in consent form v1.2 (`consent/CONSENT_FORM_v1.html`), not to meet any particular law. A lawyer may set a stricter bar.

## 1. The rule

A vendor is **approved** only when every criterion in section 2 is **Pass**, the evidence for each is saved (section 4), and Micky has signed off (section 5). One **Fail** or **Unknown** means not approved. There is no partial approval and no "approved for the pilot only".

Approval alone still sends nothing. Each clip also needs the contributor's separate tick for that vendor (form §9) and Micky's spend approval for the run (`CADDIE_V2_AUDIT.md` §11).

**The consent form is never weakened to fit a vendor** (Micky's decision, 2026-10-20). If a vendor can't meet a criterion, the vendor is excluded, not the promise.

## 2. Criteria

| # | Criterion | Pass | Fail |
|---|---|---|---|
| V1 | **Written no-training commitment** | A written statement covering **our specific configuration** (account plan, project, API or workflow used) that inputs (videos, frames, prompts) **and anything derived from them** (outputs, embeddings, logs, annotations) are **not** used to train, fine-tune, evaluate, or otherwise improve the vendor's or anyone else's models or services. Acceptable sources: the vendor's contract terms, DPA, or product terms that apply to our plan, **or** a written reply from the vendor (email or support ticket) that names our configuration. Saved with its date | Silence; marketing pages; a FAQ that doesn't bind the vendor; wording that allows "improving the Services" or "internal research"; opt-out that we can't confirm is set; a phone call or chat with no written copy |
| V2 | **Retention** | Inputs and outputs (including logs, caches, uploaded files, abuse-monitoring copies) are kept for a **stated, finite** period that fits inside the participant's 90-day maximum, or can be set to zero for our account | "As long as needed for business purposes"; no stated period for any copy |
| V3 | **Deletion** | We can delete a specific input on request (or it auto-deletes) within **7 days**, including from backups or archives, or the vendor states when backups expire and that period fits the form's withdrawal promise as written (form §7 says the vendor's own rules apply, but Micky must know what they are) | "May retain in non-public archives" with no limit |
| V4 | **Human review** | Vendor staff don't view inputs, or only for stated abuse or legal reasons under access controls (V7) | Inputs may be read to improve the product |
| V5 | **Region and transfers** | Processing and storage locations are stated, and a transfer mechanism (e.g. Standard Contractual Clauses) applies where needed. Micky decides whether the locations are acceptable for each contributor's country | Unstated, with no transfer mechanism |
| V6 | **Processor terms (DPA)** | A data processing addendum or equivalent processor terms apply **to our account** (accepted in the console, or applying automatically to our plan), naming the vendor as processor acting on our instructions | No DPA for our plan, or one that names the vendor as owner/controller of our inputs |
| V7 | **Subprocessors and access controls** | A current subprocessor list is published or provided; the vendor states security controls (e.g. SOC 2 or ISO 27001 report, encryption at rest and in transit, staff access controls) | No list; no stated controls |
| V8 | **No public or shared exposure** | Our project, workspace, and outputs are private by default and can't become public or visible to other customers; no dataset, gallery, or "share" feature is active | Free/public-plan terms; public projects; dataset or active-learning blocks in the pipeline |
| V9 | **Consent coverage** | The form names this vendor and what it receives (form v1.2 §9: Roboflow gets still frames; Gemini gets videos with sound and location removed). The planned call sends **only** that | Sending more than the form says (e.g. full video to a vendor the form says gets frames), or a vendor the form doesn't name |
| V10 | **Our side of the pipeline** | The runner sends the stripped clip from the data folder, calls `assertThirdPartyAllowed()` per clip, deletes uploaded files right after use and **checks** the deletion result, and uses no feature that adds retention (e.g. grounding, context caching, stored state, visualization outputs) | Any of these missing |

V1 is the criterion most likely to fail for Roboflow (`VENDOR_VERIFICATION.md` §5): its public terms appear to allow private-project content to be used for "internal research, optimization, training and improving the Services". Without a written answer that rules this out for our configuration, Roboflow fails V1 and stays excluded.

## 3. How the tool enforces it

`VENDOR_TERMS_VERIFIED` in `tools/caddie-eval/import-clip.mjs` stays `null` for a vendor until it passes. The entry then needs **both** dates:

```js
{ verifiedOn: "YYYY-MM-DD", noTrainingConfirmedOn: "YYYY-MM-DD", by: "Micky", checklist: "docs/caddie-v2/VENDOR_APPROVAL_CRITERIA.md" }
```

`assertThirdPartyAllowed()` refuses unless both are valid dates. `noTrainingConfirmedOn` is the date of the V1 evidence. A test pins this ("third-party gate"). Change the entry in a commit of its own, with the evidence summary (no keys or account IDs) in `VENDOR_VERIFICATION.md`.

## 4. Evidence to save

For each criterion: the source (URL and its "last updated" date, or "email from <vendor role>, <date>"), the exact sentence relied on, and the date Micky read it. Save vendor emails in the identity key folder or another private place, **not** the repo, if they contain account IDs or names. Put a one-line summary per criterion in the vendor's section of `VENDOR_VERIFICATION.md`.

## 5. Who signs off

| Step | Who |
|---|---|
| Collect evidence, tick each criterion | Micky |
| Ask the vendor in writing where evidence is missing (draft questions in `VENDOR_VERIFICATION.md` §5.1 for Roboflow) | Micky sends; the assistant drafts |
| Optional legal review, recommended if any contributor lives in another country | A lawyer Micky chooses |
| Final sign-off and the commit that sets `VENDOR_TERMS_VERIFIED` | **Micky only.** The assistant never sets it |
| Re-check | Micky, before any run more than 30 days after the last check, and whenever plan, project, key, workflow, or the vendor's terms change (`VENDOR_VERIFICATION.md` §6). Reset the entry to `null` until re-checked |

## 6. Status today

| Vendor | V1 no-training | Overall | Pilot |
|---|---|---|---|
| Roboflow | **Fail / Unknown**: public terms appear to allow training on private-project content; no written answer yet | **Not approved** | **Excluded** from the pilot baseline (Micky, 2026-10-20). Local pose instead (`LOCAL_PILOT_WORKFLOW.md`) |
| Google Gemini | **Unknown**: the Paid Services terms appear to say prompts and responses aren't used to improve products, but Micky hasn't confirmed the Caddie key's project is on the paid account, or read the terms himself | **Not approved** | **Blocked**; no participant footage. Remaining items in `VENDOR_VERIFICATION.md` §4 |
