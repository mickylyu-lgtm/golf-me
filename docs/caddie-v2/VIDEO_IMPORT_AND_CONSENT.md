# Caddie V2: video consent, import, and retention

Status: **draft for Micky's review, 2026-10-20.** Tool: `tools/caddie-eval/import-clip.mjs` (tests: `node --test tools/caddie-eval/test/*.test.mjs`).

## 1. Hard rules

1. **Only Micky's own swings and adults who gave written consent.** Never existing GolfMe user uploads, Swing Posts, or anything in Supabase Storage, even with a user's later permission, for this process.
2. **Videos never go into git.** Not in a commit, a branch, a PR, an issue, or a doc.
3. **Videos never go to the cloud as part of this process:** not production Supabase, not any bucket, not Vercel, not Roboflow, not Gemini, not Google Drive, iCloud, Dropbox, or a chat app. Sending clips to Roboflow or Gemini for a V1 baseline is a **separate decision** that needs Micky's spend approval **and** the contributor's separate tick-box consent (§3, clause 6). Until both exist, it doesn't happen.
4. **No names or emails in the repo or the data folder.** People are `C001`, `C002`, ...; coaches are `K01`, `K02`, ...
5. **Withdrawal is honored within 7 days** and deletes the clips and everything derived from them.

## 2. What lives where

| Place | Holds | Never holds |
|---|---|---|
| This repo | Code, these docs, the blank consent text and templates | Videos, consent records, labels, names, the name-to-ID key |
| **Data folder** on Micky's laptop (`GOLFME_EVAL_DATA_DIR`, default `~/golfme-eval-data`) | Clips, pseudonymous consent records, manifest, derived data (pose caches, frames), coach labels, audit log | Names, emails, signed forms, the name-to-ID key |
| **Identity key**, kept separately from the data folder | Signed consent forms and the list "C001 = <name>, contact" | Clips |

The **identity key** is the only place that links a person to an ID. Keep it apart from the clips: a password-manager secure note, or paper in a drawer. Then a lost data folder alone identifies nobody (faces are still visible in the clips, so the folder is still sensitive).

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
```

The tool **refuses** a data folder that is:

- inside this repo or **any** git checkout (it walks up looking for `.git`, after resolving symlinks);
- inside a known cloud-sync folder (Dropbox, OneDrive, Google Drive, iCloud Drive / Mobile Documents, CloudStorage, Box, MEGA, pCloud, Nextcloud, Syncthing).

`.gitignore` also ignores `golfme-eval-data/`, `tools/caddie-eval/data/`, and video files under `tools/caddie-eval/` and `docs/caddie-v2/`, in case a copy ever lands in the tree anyway.

**Laptop requirements:** full-disk encryption on (FileVault on a Mac, BitLocker on Windows). On a Mac, keep the data folder out of `~/Documents` and `~/Desktop` (these can sync to iCloud) and exclude it from Time Machine: `tmutil addexclusion ~/golfme-eval-data`.

## 3. Consent

### How it's collected

1. Give the person the text below (paper or a PDF) **before** filming. Let them ask questions. They tick the optional boxes they agree to, sign, and date it.
2. Micky picks the next unused ID (`C001`, `C002`, ...), writes it on the form, and files the form in the identity key. **IDs are never reused**, including after withdrawal.
3. Micky records the pseudonymous part with the tool (§5). The record holds only: ID, consent text version, consent date, retention date, adult yes, coach viewing yes/no, third-party processing yes/no. The tool **rejects any extra field**, so names and notes can't creep in.
4. Anyone who appears in a clip (including the "second person" trouble case) needs their own consent.

### Consent text, version 1.0

> **GolfMe Caddie testing: consent to use my swing videos**
>
> Contributor ID: ________ (written by Micky)
>
> 1. **What:** I agree that Micky, the developer of GolfMe, may film my golf swing and keep the videos, plus the club, my handedness, and my self-reported skill level. My name is not stored with the videos; they are labeled with the ID above. My face and body are visible in the videos.
> 2. **Why:** only to test and measure how accurate GolfMe's swing-analysis feature ("Caddie") is, and to tune its settings. The videos will **not** be used for marketing, posted publicly, shown in the app, sold, or used to train a machine-learning model.
> 3. **Where:** the videos are kept on Micky's own encrypted computer. They are **not** uploaded to GolfMe's servers or to any cloud storage.
> 4. **Who sees them:** Micky. ☐ *(optional)* I also agree that golf coaches helping with this testing may watch my videos to label them. Coaches see only my ID, not my name.
> 5. **How long:** until ____-__-__ (at most 24 months from today). Then the videos and everything made from them are deleted. I may be asked to renew; if I don't, they're deleted.
> 6. ☐ *(optional, off unless ticked)* I agree that my videos may be sent to the analysis services GolfMe uses (currently Roboflow and Google Gemini) to compare their results with the coaches' labels. Those services process the video under their own terms. If I don't tick this, my videos are never sent to them.
> 7. **Withdrawing:** I can change my mind at any time, without giving a reason, by telling Micky. Within 7 days my videos, the coaches' labels of them, and all data made from them are deleted. Summary numbers already written into a test report (for example "82 % of 70 clips") can't be un-calculated, but they don't identify me, and my clips are left out of all later reports.
> 8. **Voluntary:** taking part is my choice, unpaid, and has no effect on any GolfMe account I have.
> 9. I am 18 or older.
>
> Signature: ______________ Name (printed): ______________ Date: ____-__-__

Changing this text means a new version number (`1.1`, ...), updating `CURRENT_CONSENT_VERSION` in the tool, and asking existing contributors to re-consent if the change widens what they agreed to.

## 4. Getting clips onto the laptop

- **Turn off iCloud Photos** (or Google Photos backup, etc.) on the filming phone before the session. If it was on, the clips were already uploaded to that cloud; delete them there too and tell the contributor.
- Transfer by **USB cable** (Image Capture on a Mac) or **AirDrop**. Not by email, chat apps, or a shared drive.
- Put the files in a temporary folder **outside** the repo, import them (§5), then delete the temporary copies, the phone copies, and the phone's "Recently Deleted".

### Stripping audio and location

Phone videos carry audio (voices, names spoken aloud) and often **GPS location** in their metadata.

- **With ffmpeg installed** (`brew install ffmpeg` / `apt install ffmpeg`; a system tool, not a project dependency), `import` does this automatically: it keeps only the first video stream, **copies it without re-encoding**, and drops audio, subtitle and data tracks, chapters, and all container metadata. If `ffprobe` is present it then checks that no audio stream or location-like tag remains. The manifest records `stripMethod: "ffmpeg"` and `metadataVerified: true | false | null`.
- **Without ffmpeg**, do it by hand **before** import, then pass `--stripped-manually`:
  1. On the iPhone, in Photos, open the clip, tap **Edit**, tap the **speaker icon** to mute, tap **Done**.
  2. When sharing to the laptop, tap **Options** at the top of the share sheet and turn **Location off**. Share the edited version.
  3. On the Mac, check with **File > Get Info** (no "Where" row), or `mdls -name kMDItemLatitude <file>` returns `null`.
  
  The manifest records `stripMethod: "manual_attested"`: it's on trust, not machine-checked.
- **If neither was done**, the tool still imports the clip but flags it (`metadataStripped: false`). `verify` reports it until fixed, and **no coach may see it** until then. `--require-strip` makes the tool refuse instead.

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
| Record consent | `node $T consent-add --contributor C001 --consent-date 2026-10-25 --consent-version 1.0 --retention-until 2027-10-25 --adult yes --coach-viewing yes --third-party-processing no` |
| Import a clip | `node $T import --contributor C001 --file /path/IMG_0412.MOV --angle face_on --club driver --mount tripod --handedness right --lighting daylight --fps 30` |
| Add trouble tags | add `--condition partial_body` (repeatable) |
| See totals per slot | `node $T status` |
| Check everything | `node $T verify` (re-hashes every clip, checks consent, flags unstripped clips and stray files) |
| Withdraw (preview) | `node $T withdraw --contributor C001` |
| Withdraw (delete) | `node $T withdraw --contributor C001 --confirm` |
| Retention (preview) | `node $T retention` |
| Retention (delete) | `node $T retention --apply` |

What `import` enforces:

- An **active** consent record for the contributor: exists, not withdrawn or expired, not dated in the future, retention date not passed.
- A real MP4/MOV file (extension **and** file signature), not a symlink, at most 2 GiB, not already imported (by sha256).
- Capture labels from fixed lists (angle, club, mount, handedness, light, condition tags), so free text can't carry names.
- A new pseudonymous clip ID. The phone's file name and the source path are **never recorded**.
- `sha256` of the source and of the stored file, so `verify` can detect any change.

The capture labels are **what the filmer intended**. Ground truth for angle, handedness, and phases comes from coach labels.

## 6. Retention and deletion rules

| Rule | Detail |
|---|---|
| Default retention | 12 months from consent. The form allows up to 24; the tool refuses longer. |
| Renewal | A fresh signed form with a new date. Until it's recorded, the old retention date applies. |
| Expiry | Run `retention` monthly and before every evaluation run. `retention --apply` deletes the clips, `derived/`, and `labels/` for every contributor past their date and marks the record `expired`. |
| Withdrawal | Within 7 days of the request: `withdraw --confirm`. Then remove those clip IDs from any coach labeling sheet, and ask any coach holding a copy to delete it. Delete the signed form from the identity key, but keep a one-line note "C00X withdrew on <date>" so the ID is never reused. |
| Derived data | Pose caches, frames, and labels share their clip's lifecycle. Name them with the clip ID (`derived/C001-0001/`, `labels/C001-0001-K01.json`) so deletion finds them. Anything stored elsewhere must be deleted by hand. |
| Reports | Eval reports hold clip IDs and summary numbers only, never video, frames, or names. After a withdrawal, later reports exclude those clips. Earlier reports keep their summary numbers but should drop the withdrawn clip IDs from any per-clip tables. |
| Consent records | Kept after withdrawal or expiry (status updated) as proof that consent and withdrawal were handled. They contain no personal data. |
| Backups | The data folder is excluded from cloud backups. If it's ever on a local backup disk, deleted clips persist there until that backup is erased; avoid backing it up at all. |
| End of project | When Caddie V2 evaluation is finished, or at the latest retention date, delete the whole data folder and the identity key. |

## 7. Sharing with coaches

Coaches need to watch clips to label them, which is in tension with "never uploaded". The Milestone 1 default:

- **Only clips whose contributor ticked coach viewing** (`coachViewing: true` in `status`), and only stripped clips.
- **In person** on Micky's laptop, or on an **encrypted USB drive** handed to the coach and wiped when returned.
- Labels come back as a sheet keyed by clip ID and coach ID only.

Clips without coach-viewing consent can still be used for checks Micky can label himself (camera angle, "analyzable", no-swing), never for coaching-correctness metrics.

## 8. What's enforced vs on trust

| Enforced by the tool | On trust (Micky's process) |
|---|---|
| Consent record exists, is active, in date | The signed form actually exists and matches |
| No names/emails in consent records (strict fields) | Session log and labels contain no names |
| Data folder outside git checkouts and known sync folders | iCloud Photos off; transfers by cable/AirDrop |
| No original file name or path recorded | Phone copies deleted after import |
| Withdrawal and retention delete clips, `derived/`, `labels/` | Copies anywhere else (coach drives, scratch folders) deleted |
| Duplicates refused; sha256 verified | Manual metadata strip, when attested |
| No network calls in the tool | Nobody uploads clips by other means |

## 9. If something goes wrong

- **A clip was committed but not pushed:** remove it from the commit (`git reset` the commit or amend), confirm `git log -p` no longer shows it, tell the contributor.
- **A clip was pushed or uploaded anywhere:** treat it as an incident. Delete it at the destination, rewrite or remove the git history (and ask GitHub support to purge cached views if needed), tell the contributor, and write a short note in the identity key.
- **The laptop is lost:** disk encryption is the protection. Tell contributors.
