# Caddie V2: MediaPipe telemetry audit (`@mediapipe/tasks-vision` 1.1.0)

Status: **2026-10-21, branch `caddie-v2` only.** Micky's decision: keep **all** optional telemetry and usage logging blocked. Nothing in this audit was sent anywhere. The request body described in §4 was intercepted inside the headless browser on a synthetic test pattern (no person) and aborted. It never left the machine, and the run was inside an empty network namespace, so it could not have.

Related: `MEDIAPIPE_POC.md` §3 (the original finding), `tools/caddie-eval/pose-local.mjs` (how it is blocked), `tools/caddie-eval/lib/protowire.mjs` (how the body was read).

## 1. Short answer

| Question | Answer | How sure |
|---|---|---|
| Which Google endpoints does the package contact? | **One:** `POST https://odml.pa.googleapis.com/v1/log` (MediaPipe's usage-metrics logger). No other network endpoint exists in the bundle or the WASM loader. Model and WASM files are fetched only from the paths we pass in | **Verified** in the package source (§2) and in the network log of every run (§3) |
| Why? | To send "metrics about the performance and utilization of the APIs" to Google (the package README's privacy notice) | Verified (README text; code matches) |
| Is it needed for inference? | **No.** With the call blocked, inference runs normally; the logger notes the failure and stops trying | **Verified** (code path §2.4; every run, including the smoke tests) |
| Can it be turned off by a supported option? | **No supported option found.** No `BaseOptions` / `PoseLandmarkerOptions` field, no documented flag. The type file declares `enableLogging()` but the shipped bundle doesn't contain it. Google's Tasks docs and terms describe the metrics and give no opt-out | Verified for the package and the two Google pages read; **unverified** that no other official page documents one |
| Does it send images, video, landmarks, or IDs? | **No images, video, or landmarks.** It sends counters and timings, the task type, running mode, OS family, and SDK version. The browser adds normal request headers (user agent, origin, referer), and Google sees the IP address | Verified for this version, task (`PoseLandmarker`), and running mode (`VIDEO`) from an intercepted body (§4) |
| What do we do? | Block it at two layers in every local run and record the evidence (§5). Any future in-app use needs a decision first (§6) | — |

## 2. Where it is in the code

Files are in `node_modules/@mediapipe/tasks-vision/` (version 1.1.0, Apache-2.0). `vision_bundle.mjs` (sha256 `9d5fc9ef74b22329cf9aa88dc543956d192b8c254210b187271614713eb5b10c`) is minified onto one line, so locations are **character offsets** into that file. The minified names (`bh`, `Mh`, `Uh`) are specific to this build. `vision_bundle.cjs` and `vision_bundle.js` contain the same code (one `odml.pa.googleapis.com` each).

### 2.1 Every network-capable call site in the package

| Offset | Code | What it fetches | Who chooses the URL |
|---|---|---|---|
| 51004 | `var bh=class{...async send(t,e,r){... fetch(t.url,{method:t.cb,headers:{...t.bb},...})}}` | The logger's transport. Used only by the logger in §2.2 | The package (hard-coded URL) |
| ~58693 | `initializeGraph(t){var e=await(await fetch(t)).arrayBuffer() ...}` | A graph file, when the caller passes a URL (we don't) | Caller |
| ~69364 | `if(e.modelAssetPath)return fetch(e.modelAssetPath.toString())` | The model file | Caller (we pass `/model/pose.task`, served locally) |
| 56239 | `jh(t)`: adds a `<script src>` / `importScripts` | The WASM loader JS | Caller, through `FilesetResolver.forVisionTasks(path)` (we pass `/mp/wasm`, served locally) |
| `wasm/vision_wasm_internal.js` 5334, 11988 and XHRs | Emscripten loader: `fetch(binaryFile)`, file/XHR readers | The `.wasm` binary and any lazy files | Caller (located next to the loader) |

Other `https://` strings in the WASM loader are comments and documentation links. In the `.wasm` binaries, the only `googleapis.com` strings are `type.googleapis.com/...`, which are protobuf type names, not network addresses. No `sendBeacon`, `WebSocket`, or `navigator.onLine` use anywhere.

### 2.2 The logger

| Offset | What it does |
|---|---|
| 52569 | `Mh=class{constructor(t){this.i=[],this.o=new bh,this.l=t??"",this.h=setInterval(()=>{this.flush()},6e4)}` : a queue, the transport, an API key, and a **60-second flush timer** |
| 52648 to 53121 | `flush()`: if anything is queued, wraps it in a message whose field 2 is the constant `1786` (offset 52903) and POSTs it to `https://odml.pa.googleapis.com/v1/log` (offset 52948) with `Content-Type: application/x-protobuf`, header `x-goog-api-key: <key>`, `withCredentials: false`, a 10 s timeout |
| 53121 | On any failure: `this.error=Error("Logging failed with HTTP error: ...")`, the queue is dropped and the timer cleared. Every later `flush()` returns `net-send-failed` **without sending** |
| `close()` | Clears the timer and flushes once |

### 2.3 What feeds it

| Offset | What it does |
|---|---|
| 53834 | `var Uh=class{constructor(t,e,r){...this.m=new Mh(r) ...}}`: per-task metrics. Maps the task name to a number (`PoseLandmarker` = 23) and the running mode (`IMAGE` 11, `VIDEO` 12, `LIVE_STREAM` 13) |
| 54972 | Reads `navigator.userAgent` and keeps only an OS family code: Android 1, iPhone/iPad 2, Linux 3, Mac 4, Windows 5, else 0 |
| 55148 | Client info: OS family, three empty strings, SDK version `"1.1.0"`, and the constant `4` |
| 66673 | `Ta()`: the API key comes from the WASM export `_mediapipeLoggerGetEncodedApiKey`, base64-decoded. It is Google's key for this logger, shipped inside the public package; it identifies the SDK, not us. **Not reproduced here** |
| **67622** | `t.o=new Uh(t.D(),e,r)`: runs inside **every** task's creation (`createFromOptions` and friends). **Unconditional:** no option, flag, or environment check is consulted |
| 70291 | `setGraph(...)` calls `this.o?.za()`: queues an "initialized" event with the init time |
| `finishProcessing` / `Aa` | Per call: counts calls and latency; at most every 30 s queues a stats event |
| 70437 | `close(){... this.o?.ya(), this.o?.close() ...}`: queues a final stats event and flushes |

### 2.4 Why inference doesn't depend on it

The logger is a side object (`this.o`) of the task runner. Detection never waits on it: `send()` is fire-and-forget, errors are caught inside `bh.send` and become status codes, and the failure path in §2.2 only disables logging. Measured: every local run with the call blocked produced normal results (the synthetic runs in `MEDIAPIPE_POC.md` §4 and the 2026-10-21 runs below).

### 2.5 Supported ways to disable it

- **Task options:** `BaseOptions` has only `modelAssetPath`, `modelAssetBuffer`, `delegate` (`vision.d.ts` line 17 onwards). `PoseLandmarkerOptions` adds running mode, pose counts, thresholds, segmentation. Nothing about logging or metrics.
- **`enableLogging(options)`:** declared on `TaskRunner` in `vision.d.ts` (line 2872), with no comment. The string `enableLogging` appears **nowhere** in `vision_bundle.mjs`, `.cjs`, or `.js`, so it can't be called in 1.1.0 (Closure would have exported it by name). Its intended meaning is unknown. **Unverified;** don't rely on it.
- **Package README, "Privacy Notice" (last modified June 5, 2026, lines 212 to 224 of the package README):** "MediaPipe Tasks APIs send metrics about the performance and utilization of the APIs in your app to Google... You are responsible for obtaining informed consent from your app users about Google's processing of MediaPipe metrics data as required by applicable law." No opt-out is mentioned.
- **Google's pages, read 2026-10-21:** the MediaPipe Tasks overview (<https://developers.google.com/edge/mediapipe/solutions/tasks>) repeats the notice; the MediaPipe APIs Terms of Service (<https://developers.google.com/edge/mediapipe/legal/tos>) list what usage data covers ("SDK usage/downloads, installs, and session counts", "Inference counts and hardware-level performance metrics", "App ID and general characteristics of processed media", "Host system and version"). Neither says how to turn it off. A web search found no documented opt-out for the web SDK. **Unverified beyond those pages.**

Conclusion: in 1.1.0 there is **no supported configuration** that stops the logger. The only ways are to stop the request from leaving (what we do) or to modify the package (not done; it would be an unsupported patch to re-check on every upgrade).

## 3. Network log

Every `pose-local.mjs` run records the network in its run file (`derived/<clip>/pose-mediapipe-<variant>.run.json`, field `network`). The two 2026-10-21 runs on the synthetic test pattern (2 s, 1080x1920, 30 fps, Full model, CPU, under `unshare --net`); the 2026-10-20 runs in `MEDIAPIPE_POC.md` §4 showed the same `blocked` entry:

| Field | Value in every run | Meaning |
|---|---|---|
| `allowedRequests` | 5 | Page, bundle, WASM loader JS, WASM binary, model: all from local files |
| `framesServed` | 60 (one per frame) | Frames from memory, never from disk |
| `externalRequestsAllowed` | 0 | No request was ever passed to the network (by construction: the route handler only fulfills from local files or aborts) |
| `blocked` | `{"odml.pa.googleapis.com": 1}` | One attempt, at `close()` (runs are shorter than the 60 s timer). On a run longer than 60 s it would still be 1: after the first failure the logger stops (§2.2) |
| `blockedWebSockets` | 0 | |
| `osIsolation` | `{"netns": ..., "nonLoopbackInterfaces": 0, "isolated": true}` | The process had no network interface at all (`os.networkInterfaces()` was empty) |

## 4. The blocked request, intercepted

Captured by the route handler (`summarizeBlockedRequest`, `lib/protowire.mjs`) in a 2 s synthetic run under `unshare --user --map-root-user --net`, then aborted. Header **values** are not recorded; the API key is recorded only as present.

- `POST https://odml.pa.googleapis.com/v1/log`, no query string, body **139 bytes**, `application/x-protobuf`.
- Header names: `accept`, `content-type`, `origin`, `referer`, `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `user-agent`, `x-goog-api-key`. The browser adds origin, referer, user agent, and client hints by itself. In our harness they say `http://caddie-eval.invalid` and headless Chromium; **in an app they would carry the app's origin and page URL (referer) and the user's browser and OS.** Google would also see the sender's IP address.

Body, decoded without a schema (field numbers; meanings from the code in §2, so **inferred, not documented by Google**):

| Field | Value seen | Meaning (inferred from the code) |
|---|---|---|
| 2 | `1786` | Constant set by the logger (offset 52903); likely the log source ID |
| 3 (repeated, 3 events) | | One per queued event; each holds field 6 = an encoded event |
| ..6.1.1 | `3` | OS family from the user agent (3 = Linux) |
| ..6.1.2, .3, .5 | `""` | Three empty strings (the code sets them to `""`; probably app or host fields left blank on web) |
| ..6.1.4 | `"1.1.0"` | SDK version |
| ..6.1.6 | `4` | Constant (probably "web SDK") |
| ..6.2.1 | `23` | Task type: `PoseLandmarker` |
| ..6.2.2 | `0`, `1`, `2` | Event kind: init, periodic stats, final stats at close |
| init: ..6.2.3.1 / .3 | `12` / `198` | Running mode `VIDEO`; init time 198 ms |
| stats: .1 | `12` | Running mode |
| stats: .4 | `17` | Mean latency per call, ms (sum / count) |
| stats: .5 | `160` | Max latency per call, ms (matches the run's own max of 161 ms) |
| stats: .6 | `4371` | Elapsed time, ms |
| stats: .7 | `0` | Calls that never finished |
| stats: .8 | `{1: 3, 2: 60}` | A counter of type 3 with value 60 = the number of frames processed |

So for this version, task, and mode, the body holds **no pixels, no landmarks, no file names, no clip or user identifiers.** It does reveal usage: that MediaPipe pose ran, when, how many frames, how fast, on which OS family. Together with the IP address and request headers, that is still personal data about whoever runs it, which is why the notice puts consent on the developer. Other tasks or versions may send different fields; this was not checked.

## 5. How it is blocked in the local pilot

1. **Browser layer:** the page runs on a fake origin, and Playwright answers every request from a local allowlist or aborts it (`routeDecision` in `pose-local.mjs`). DNS is mapped to nothing (`--host-resolver-rules`), background networking is off, service workers and WebSockets are blocked.
2. **OS layer (new, 2026-10-21):** on Linux, including WSL, `pose-local.mjs` re-runs itself inside an **empty network namespace** (`unshare --user --map-root-user --net`, no root needed). There is no interface to send on, so even a request that slipped past the browser layer couldn't leave. The run file records `osIsolation`. `--no-netns` turns it off (the run file then shows `isolated: false`).
3. **Evidence per run:** `externalRequestsAllowed` (always 0), blocked hosts and counts, a field-level summary of each blocked request, `osIsolation`. `pilot-report.mjs` turns this into the §0 offline table and flags any blocked host other than `odml.pa.googleapis.com` as unexpected.

`keyframes.mjs label` doesn't run MediaPipe. Its page loads nothing external (CSP `'self'`) and talks only to the loopback server.

## 6. If MediaPipe ever runs inside the GolfMe app

Not planned on this branch; recorded so the decision isn't missed:

- The call would go from users' devices to Google with their IP, browser, and the GolfMe origin and page URL. That is a third-party transfer the privacy policy doesn't mention today, and the README puts the consent duty on us.
- To keep it blocked in the app: a CSP `connect-src` that doesn't list `odml.pa.googleapis.com` (the logger then fails once and stops, as in §2.2). That's supported browser behavior, not a MediaPipe option. Re-audit on every package upgrade, because the logger, its fields, or its endpoint can change.
- The alternative is to disclose it and get consent. That's Micky's call, not made here.

## 7. Re-checking after an upgrade

```
cd node_modules/@mediapipe/tasks-vision
grep -o "https\?://[a-zA-Z0-9./_-]*" vision_bundle.mjs | sort | uniq -c   # endpoints
grep -c enableLogging vision_bundle.mjs                                   # option now shipped?
grep -n -A14 "Privacy Notice" README.md                                   # notice wording
```

Then run the opt-in smoke test (`CADDIE_EVAL_SMOKE=1`, under `unshare --user --map-root-user --net`) and compare `network.blockedRequests` with §4.
