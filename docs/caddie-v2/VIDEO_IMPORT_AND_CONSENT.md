# Caddie V2: video consent, import, and retention

Status: **draft for Micky's review, 2026-10-20; updated the same day with Micky's testing decisions** (2 coaches, 90-day retention, consent form v1.1, third-party processing only after vendor verification and a separate opt-in, adults only). Tool: `tools/caddie-eval/import-clip.mjs` (tests: `node --test tools/caddie-eval/test/*.test.mjs`). Not legal advice: see §3.

Related: `consent/CONSENT_FORM_v1.html` (+ `.pdf`), `consent/COACH_CONFIDENTIALITY_v1.html` (+ `.pdf`), `VENDOR_APPROVAL_CRITERIA.md`, `VENDOR_VERIFICATION.md`, `COACH_REVIEW_PROCEDURE.md`, `LOCAL_PILOT_WORKFLOW.md`, `PILOT_CHECKLIST.md`, `TESTING_PROTOCOL.md`.

**Update 2026-10-20 (Micky's final testing decisions):** remote coach review is **Option A, live screen-share with no recording**; coaches sign a confidentiality and data-handling agreement and are recorded with `coach-add`; `coach-session-check` gates every coach session. Roboflow is excluded from the pilot until it confirms in writing that our configuration won't use the footage for training; Gemini stays blocked; the form is **not** weakened. The pilot uses a local pose source.

## 1. Hard rules

1. **Only Micky's own swings and adults (18+) who signed the consent form.** Never existing GolfMe user uploads, Swing Posts, or anything in Supabase Storage, even with a user's later permission, for this process.
2. **Videos never go into git.** Not in a commit, a branch, a PR, an issue, or a doc.
3. **Videos never go to the cloud as part of this process:** not production Supabase, not any bucket, not Vercel, not Google Drive, iCloud, Dropbox, or a chat app. Sending clips to **Roboflow or Gemini** for a V1 baseline needs **all three**: (a) that vendor approved against `VENDOR_APPROVAL_CRITERIA.md`, including a **written no-training commitment** for our configuration, (b) the contributor's **separate tick for that processor** on the form, (c) Micky's spend approval. The tool enforces (a) and (b) through `assertThirdPartyAllowed()`; today both vendors are unapproved, so nothing may be sent.
4. **No names or emails in the repo or the data folder.** People are `C001`, `C002`, ...; coaches are `K01`, `K02`, ...
5. **Raw clips are kept at most 90 days** (provisional maximum) from the consent date, then deleted with everything derived from them.
6. **Withdrawal is honored within 7 days** and deletes the clips and all linked evaluation data (§6.1 lists the limits).

## 2. What lives where

| Place | Holds | Never holds |
|---|---|---|
| This repo | Code, these docs, the **blank** consent form and coach agreement (HTML and PDF), templates | Videos, consent records, coach records, labels, names, the name-to-ID key, signed forms |
| **Data folder** on Micky's laptop (`GOLFME_EVAL_DATA_DIR`, default `~/golfme-eval-data`) | Clips, pseudonymous consent records, pseudonymous coach records (agreement version and date only), manifest, derived data (pose caches, frames), coach labels (clip ID + coach ID only), audit log | Names, emails, signed forms or agreements, the name-to-ID key |
| **Identity key**, kept separately from the data folder | Signed consent forms, signed coach agreements, and the lists "C001 = <name>, contact" and "K01 = <coach name>, contact" | Clips, labels |

The **identity key** is the only place that links a person to an ID. Keep it apart from the clips: a password-manager secure note plus a local folder for signed PDFs, or paper in a drawer. Then a lost data folder alone identifies nobody (faces are still visible in the clips, so the folder is still sensitive).

### The data folder

```
~/golfme-eval-data/          (mode 700)
  README.txt                 "local only" notice
  manifest.json              one entry per clip; "revision" bumps on every change
  audit-log.jsonl            what happened, IDs and dates only
  consent/C001.json          one pseudonymous record per contributor
  clips/C001-0001.mov        the stored clip (stripped when ffmpeg is present)
  derived/C001-0001/...      pose caches, extracted frames, harness output
  labels/C001-0001-K01.json  coach labels, one file per clip per coach
  coaches/K01.json           pseudonymous coach agreement record (no names)
```

Coach labels and coach records are kept apart from participant identity: they carry only clip IDs and coach IDs, and `verify` flags a label file with any field outside the protocol list (`TESTING_PROTOCOL.md` §8), a name that isn't `<clip ID>-<coach ID>.json`, or a coach ID without a record. Free-text label fields are on trust (no names).

The tool **refuses** a data folder that is:

- inside this repo or **any** git checkout (it walks up looking for `.git`, after resolving symlinks);
- inside a known cloud-sync folder (Dropbox, OneDrive, Google Drive, iCloud Drive / Mobile Documents, CloudStorage, Box, MEGA, pCloud, Nextcloud, Syncthing).

`.gitignore` also ignores `golfme-eval-data/`, `tools/caddie-eval/data/`, and video files under `tools/caddie-eval/` and `docs/caddie-v2/`, in case a copy ever lands in the tree anyway.

**Laptop requirements:** full-disk encryption on (BitLocker on Windows, FileVault on a Mac). Keep the data folder out of synced folders (on Windows, OneDrive often syncs Documents and Desktop; on a Mac, iCloud can sync them). Exclude it from cloud backups; on a Mac, also from Time Machine: `tmutil addexclusion ~/golfme-eval-data`.

## 3. Consent

**The form:** `docs/caddie-v2/consent/CONSENT_FORM_v1.html`, **form version 1.2** (2026-10-24; adds videos recorded before signing, §2 and §4), with a pre-rendered `CONSENT_FORM_v1.pdf` beside it. To re-render after a change: `node tools/caddie-eval/render-consent-pdf.mjs`, or open the HTML in Chrome (e.g. on Windows), Print, Destination "Save as PDF", A4, margins Default, background graphics off. The earlier inline text "version 1.0" was an unsigned draft and is no longer valid; the tool refuses it.

> **Not legal advice.** The form was drafted for an informal, unpaid test with adult friends. Micky may want a lawyer to review it before first use, particularly if any participant lives in another country (data-protection rules differ, e.g. UK/EU GDPR, Hong Kong PDPO).

The form covers: what is filmed and recorded; purpose (Caddie testing only, no marketing, no model training); storage (Micky's encrypted laptop, no cloud); who sees clips (Micky; coaches only by opt-in, in person or remote); **optional, separate** opt-ins for Roboflow and for Gemini; retention (at most 90 days, with the date written in); withdrawal rights, how to withdraw, and its limits; adult confirmation; affirmative consent; signature and date.

### How it's collected

1. Send or hand the person the **blank** PDF **before** filming. Let them ask questions. They tick the boxes they agree to, sign (on paper, or digitally in a PDF reader's fill-and-sign), and date it. Give them a copy.
2. Micky picks the next unused ID (`C001`, `C002`, ...), writes it and the contact line on the form, writes the retention date (at most 90 days after the consent date), and countersigns. **IDs are never reused**, including after withdrawal.
3. The signed form goes in the identity key. If it came back by email or a chat app, save it to the identity key and delete it from the chat/email afterwards (it carries a name and signature, not footage).
4. Micky records the pseudonymous part with `consent-add` (§5), copying the form's office-use block. The tool **rejects any extra field**, so names and notes can't creep in.
5. Anyone who appears in a clip (including the "second person" trouble case) needs their own form.

### Form to record mapping

| Form | `consent-add` flag | Record field | Rule enforced by the tool |
|---|---|---|---|
| Form version 1.2 | `--form-version 1.2` | `formVersion` | Must equal `CURRENT_FORM_VERSION` |
| Date signed | `--consent-date` | `consentDate` | Not in the future |
| Retention date (§6) | `--retention-until` | `retentionUntil` | After consent date, **at most 90 days** later, not already passed |
| "I am 18 or older" (§10) | `--adult yes` | `adult` | Must be `true` |
| "I have read this form and agree" + signature (§10) | `--signed yes` | `affirmativeConsent` | Must be `true`; **import refuses without it** |
| Coaches in person (§8) | `--coach-viewing yes\|no` | `coachViewing` | |
| Coach in another place (§8) | `--remote-coach-viewing yes\|no` | `remoteCoachViewing` | Needs `coachViewing` |
| Roboflow (§9) | `--roboflow yes\|no` | `thirdPartyRoboflow` | Checked by `assertThirdPartyAllowed` |
| Google Gemini (§9) | `--gemini yes\|no` | `thirdPartyGemini` | Checked by `assertThirdPartyAllowed` |

Changing the form's wording means a new version number (`1.3`, ...), updating `CURRENT_FORM_VERSION` in the tool, re-rendering the PDF, and asking existing contributors to re-consent if the change widens what they agreed to.

## 4. Getting clips onto the laptop

- **Turn off iCloud Photos** (or Google Photos backup, etc.) on the filming phone before the session. If it was on, the clips were already uploaded to that cloud; delete them there too and tell the contributor.
- Transfer by **USB cable** (on Windows: Photos app import or File Explorer; on a Mac: Image Capture) or **AirDrop**. Not by email, chat apps, or a shared drive.
- Put the files in a temporary folder **outside** the repo and outside any synced folder, import them (§5), then delete the temporary copies, the phone copies, and the phone's "Recently Deleted".

### Earlier videos (filmed or sent before the form was signed)

Form v1.2 (Micky, 2026-10-24) also covers swing videos that already exist, for example ones Micky filmed earlier or a golfer sent him by iMessage or WhatsApp. Only for adults who sign v1.2, and never GolfMe app uploads or Swing Posts (rule 1 still applies).

1. Before signing, Micky writes the number of earlier videos and their date or dates in §2 of the form. Videos not listed there are not covered.
2. The signed form comes back first; nothing is imported before the consent record exists (`consent-add --form-version 1.2`).
3. A video that arrived in a chat app is saved to Photos, then copied to the laptop by cable like any other clip. It is never forwarded again (not to Telegram, email, or a drive).
4. After import, Micky deletes his copies in the chat thread, on the phone, in "Recently Deleted", and in iCloud Photos (or another photo backup). The golfer may delete theirs; §4 of the form tells them so.

### Stripping audio and location

Phone videos carry audio (voices, names spoken aloud) and often **GPS location** in their metadata.

- **With ffmpeg installed** (a system tool, not a project dependency), `import` does this automatically: it keeps only the first video stream, **copies it without re-encoding**, and drops audio, subtitle and data tracks, chapters, and all container metadata. If `ffprobe` is present it then checks that no audio stream or location-like tag remains. The manifest records `stripMethod: "ffmpeg"` and `metadataVerified: true | false | null`.
- **Without ffmpeg**, do it by hand **before** import, then pass `--stripped-manually`:
  1. On the iPhone, in Photos, open the clip, tap **Edit**, tap the **speaker icon** to mute, tap **Done**.
  2. When sharing to the laptop, tap **Options** at the top of the share sheet and turn **Location off**. Share the edited version.
  3. Check on the laptop: Windows, right-click > Properties > Details (no GPS rows); Mac, **File > Get Info** (no "Where" row) or `mdls -name kMDItemLatitude <file>` returns `null`.

  The manifest records `stripMethod: "manual_attested"`: it's on trust, not machine-checked.
- **If neither was done**, the tool still imports the clip but flags it (`metadataStripped: false`). `verify` reports it until fixed, and `coach-check` and `assertThirdPartyAllowed` refuse it. `--require-strip` makes the import refuse instead.

The original file is never modified or deleted by the tool.

## 5. Commands

Set the folder once per shell if not using the default:

```
export GOLFME_EVAL_DATA_DIR=~/golfme-eval-data
T=tools/caddie-eval/import-clip.mjs
```

| Step | Command |
|---|---|
| Create the folder | `node $T init` |
| Record consent | `node $T consent-add --contributor C001 --form-version 1.2 --consent-date 2026-10-25 --retention-until 2027-01-23 --adult yes --signed yes --coach-viewing yes --remote-coach-viewing no --roboflow no --gemini no` |
| Import a clip | `node $T import --contributor C001 --file /path/IMG_0412.MOV --angle face_on --club driver --mount tripod --handedness right --lighting daylight --skill mid --fps 30` |
| Add trouble tags | add `--condition partial_body` (repeatable) |
| See totals and coverage | `node $T status` (per slot, per angle/club/handedness/skill, left-handed share) |
| Check everything | `node $T verify` (re-hashes every clip, checks consent, flags unstripped clips and stray files) |
| Which clips coaches may see | `node $T coach-check` (in person) / `node $T coach-check --remote` |
| Which clips a vendor may get | `node $T third-party-check --processor roboflow` (refuses everything until verified) |
| Record a signed coach agreement | `node $T coach-add --coach K01 --agreement-version 1.0 --agreement-date 2026-10-25 --signed yes --in-person yes --remote-sessions no` |
| Gate a coach session (run on the day) | `node $T coach-session-check --coach K01` / `node $T coach-session-check --coach K02 --remote` |
| End a coach's participation | `node $T coach-revoke --coach K02` |
| Withdraw (preview) | `node $T withdraw --contributor C001` |
| Withdraw (delete) | `node $T withdraw --contributor C001 --confirm` |
| Retention (preview) | `node $T retention` |
| Retention (delete) | `node $T retention --apply` |

What `import` enforces:

- An **active, affirmative** consent record for the contributor: exists, current schema, adult and signed, not withdrawn or expired, not dated in the future, retention date not passed.
- A real MP4/MOV file (extension **and** file signature), not a symlink, at most 2 GiB, not already imported (by sha256).
- Capture labels from fixed lists (angle, club, mount, handedness, light, self-reported skill, condition tags), so free text can't carry names.
- A new pseudonymous clip ID. The phone's file name and the source path are **never recorded**.
- `sha256` of the source and of the stored file, so `verify` can detect any change.

The capture labels are **what the filmer intended** (skill is what the contributor reported). Ground truth for angle, handedness, phases, and skill comes from coach labels.

## 6. Retention and deletion rules

| Rule | Detail |
|---|---|
| Maximum retention | **90 days** from the consent date (provisional maximum, Micky's decision 2026-10-20). The form has the date written in; the tool refuses anything longer. Use the full 90 days unless the contributor asks for less. |
| Renewal | **Not supported by the tool for now.** At the retention date the clips are deleted. To keep testing with that person, they sign a new form and are filmed again under a new contributor ID. Plan so the clips are labeled and scored well inside 90 days (`TESTING_PROTOCOL.md` §1). If renewal is ever needed, it should be a new `consent-renew` command (new signed date, same 90-day cap, audit line), not a hand edit. |
| Expiry | Run `retention` **weekly** and before every evaluation run. `retention --apply` deletes the clips, `derived/`, and `labels/` for every contributor past their date and marks the record `expired`. |
| Withdrawal | Within 7 days of the request: `withdraw --confirm`. Then remove those clip IDs from any coach labeling sheet, and ask any coach holding a copy to delete it and confirm. Delete the signed form from the identity key, but keep a one-line note "C00X withdrew on <date>" so the ID is never reused. |
| Derived data | Pose caches, frames, and labels share their clip's lifecycle. Name them with the clip ID (`derived/C001-0001/`, `labels/C001-0001-K01.json`) so deletion finds them. Anything stored elsewhere must be deleted by hand. |
| Reports | Eval reports hold clip IDs and summary numbers only, never video, frames, or names. After a withdrawal or expiry, later reports exclude those clips. Earlier reports keep their summary numbers but drop the clip IDs from any per-clip tables. |
| Consent records | Kept after withdrawal or expiry (status updated) as proof that consent and withdrawal were handled. They contain no personal data. |
| Backups | The data folder is excluded from cloud backups. Don't back it up to a local disk either; if a copy ever exists there, deleted clips persist until that backup is erased. |
| End of project | When Caddie V2 evaluation is finished, delete the whole data folder and the identity key. |

### 6.1 What withdrawal and expiry can and can't undo

Stated plainly on the form (§7) and here:

- **Fully deleted by the tool:** the clip files, everything in `derived/` and `labels/` for that contributor's clip IDs, and their manifest entries.
- **Not automatically deleted (manual steps):** copies held by a coach (encrypted USB, a coach's own notes), labeling sheets kept outside the data folder, scratch folders, and the phone's "Recently Deleted". Micky must chase each one; the CLI prints the clip IDs to remove.
- **Can't be undone:** summary numbers already in a written report (e.g. "82 % of 70 clips"). They don't identify anyone; later reports exclude the clips.
- **Vendor copies:** if a clip was sent to Roboflow or Gemini under that contributor's opt-in, deletion there depends on the vendor's own rules and timing (`VENDOR_VERIFICATION.md`). Micky asks for deletion and records the request.
- **Backups and disk forensics:** an ordinary file delete doesn't overwrite the disk. Full-disk encryption is what protects the laptop; if a local backup existed, the clips survive there until it's erased.
- **What's kept:** the pseudonymous consent record (status `withdrawn`/`expired`), audit-log lines (IDs and dates only), and the identity-key note "C00X withdrew on <date>".

## 7. Sharing with coaches

Plan: **two qualified coaches**, `K01` **in person** and `K02` **remote** if feasible (`TESTING_PROTOCOL.md` §8). **Neither is recruited yet.** Only clips listed by `coach-check` (in person) or `coach-check --remote` may be shown: consent active, the right opt-in ticked, audio and metadata stripped.

**Before any session** (Micky's decision 2026-10-20): the coach signs the confidentiality and data-handling agreement (`consent/COACH_CONFIDENTIALITY_v1.pdf`), Micky records it with `coach-add`, and `coach-session-check --coach K0X [--remote]` passes on the day. For remote, the screen-share platform must be reviewed in the last 30 days (`COACH_REVIEW_PROCEDURE.md` §4). Step-by-step procedure: `COACH_REVIEW_PROCEDURE.md`.

**Consent coverage checked (2026-10-20):** form v1.1 §8 already covers remote review by live screen-share with no recording and no file sent, and §5 says coaches see the Contributor ID, never the name. No form change is needed; `remoteCoachViewing` maps to that tick.

### In person (K01)

On Micky's laptop, with Micky present. No copy leaves the laptop. Labels are typed into the labeling sheet, keyed by clip ID and coach ID only.

### Remote (K02): options that keep clips off cloud storage

**Chosen for the pilot: Option A on Google Meet** (Micky, 2026-10-20), with participant IDs only, no copies, recordings, screenshots, or downloads, a signed coach agreement, and Meet's settings reviewed (`COACH_REVIEW_PROCEDURE.md` §4.1). Options B and C are not used in the pilot. Each option needs the contributor's `remoteCoachViewing` tick:

| Option | How | Clip leaves the laptop? | Needs Micky's approval because |
|---|---|---|---|
| **A. Live screen-share, no recording** (**chosen**, on Google Meet) | Micky plays the clip on his laptop and shares his screen in a video call. Recording off on both sides; the coach agrees in writing not to screen-record. Coach uses Micky's frame-step controls by asking ("back one frame") | No file is sent; the call service carries the picture live | A video-call service (e.g. FaceTime, Zoom, Google Meet, Teams) relays the stream; its own recording/retention settings must be checked, and the coach could screen-capture on trust. Frame-accurate phase timing is slower this way |
| **B. Encrypted USB drive by tracked post** | Clips copied to a hardware-encrypted drive or an encrypted container (e.g. VeraCrypt, BitLocker To Go); password sent by a different channel; coach returns the drive; Micky wipes it. The coach confirms no copies were made | Yes, physically, encrypted | Postal loss risk, a copy on a third-party device, and a return/wipe step to track |
| **C. Remote coach labels only what they can from screen-share; timing done in person by K01** | K02 does faults and feedback-accuracy (pass 2) by screen-share; phase times come from K01 only | No | Reduces double-labeling for phase times, which weakens the agreement statistics |

**Not proposed** (they put clips on cloud storage): shared drive links, email attachments, chat-app sends, any upload to a labeling SaaS.

Clips without coach-viewing consent can still be used for checks Micky can label himself (camera angle, "analyzable", no-swing), never for coaching-correctness metrics.

## 8. What's enforced vs on trust

| Enforced by the tool | On trust (Micky's process) |
|---|---|
| Consent record exists, is affirmative, adult, current form, active, in date | The signed form actually exists and matches |
| Retention at most 90 days; expiry deletion with `retention --apply` | Running `retention` weekly |
| No names/emails in consent records (strict fields) | Session log and labels contain no names |
| Data folder outside git checkouts and known sync folders | iCloud Photos off; transfers by cable/AirDrop |
| No original file name or path recorded | Phone copies deleted after import |
| Withdrawal and retention delete clips, `derived/`, `labels/` | Copies anywhere else (coach drives, sheets, scratch folders) deleted |
| Duplicates refused; sha256 verified | Manual metadata strip, when attested |
| `coach-check` lists only opted-in, stripped clips | Coaches shown only those clips; no screen recording |
| `coach-session-check`: signed coach agreement recorded (current version), session type cleared, platform reviewed within 30 days for remote | The coach actually honours the agreement (no capture by another device); platform settings really match the review |
| Label files: protocol fields only, `<clip>-<coach>.json`, known coach | Free-text label fields contain no names |
| `assertThirdPartyAllowed`: vendor verified **with** a dated written no-training commitment, **and** per-processor opt-in | Every baseline runner calls it; spend approval obtained |
| No network calls in the tool | Nobody uploads clips by other means |

## 9. If something goes wrong

- **A clip was committed but not pushed:** remove it from the commit (`git reset` the commit or amend), confirm `git log -p` no longer shows it, tell the contributor.
- **A clip was pushed or uploaded anywhere:** treat it as an incident. Delete it at the destination, rewrite or remove the git history (and ask GitHub support to purge cached views if needed), tell the contributor, and write a short note in the identity key.
- **A clip was sent to a vendor without the opt-in:** stop the run, request deletion from the vendor, tell the contributor, note it in the identity key.
- **The laptop is lost:** disk encryption is the protection. Tell contributors.
