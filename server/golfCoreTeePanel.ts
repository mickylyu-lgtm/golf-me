import { GOLFCORE_TEE_PILOT_ROW_COUNTS, isGolfCoreTeePilotCourse } from "../src/lib/golfCoreTeePilot.js";
import { en, type TranslationKey } from "../src/i18n/locales/en.js";
import { es } from "../src/i18n/locales/es.js";
import { ja } from "../src/i18n/locales/ja.js";
import { ko } from "../src/i18n/locales/ko.js";
import { zhCN } from "../src/i18n/locales/zh-CN.js";
import { zhTW } from "../src/i18n/locales/zh-TW.js";
import { makeTranslator } from "../src/i18n/translate.js";

const REVIEWED_ON = "2026-11-22";
const FIRST_VALID_MS = Date.parse(REVIEWED_ON + "T00:00:00Z");
const EXPIRY_MS = Date.parse("2027-02-20T00:00:00Z");
const MAX_BYTES = 16_384;
const PUBLIC_URL = "https://www.golfcore.org/courses/";
const dictionaries = { en, es, ja, ko, "zh-CN": zhCN, "zh-TW": zhTW };
type Locale = keyof typeof dictionaries;
type Tee = readonly [name: string, group: "men" | "women", course: number, slope: number];
type ReviewedCourse = { slug: string; tees: Tee[] };
type Request = { courseId: string; locale: Locale };

const ATTRIBUTION = "GolfCore";
// Restrict source pages independently of the supplied snapshot's tee values.
const COURSE_SLUGS: Readonly<Record<string, string>> = Object.freeze({
  "f2f2e6e8-2a64-4950-b88b-a616c82f43d9": "dyker-beach-golf-course",
  "7a02b0f8-2248-48b6-89b5-bae6a01c7164": "van-cortlandt-golf-course",
  "ff8ce37e-0a9a-4817-82dc-f8fe3d4adbd8": "marine-park-golf-club",
  "5b56120e-cecf-4e76-b929-fb195a0ddd13": "hendricks-field-golf-club",
  "53ac3cc1-3ee1-4b8d-bf67-af0b339db68e": "weequahic-golf-course",
  "bfc39896-41ed-45f6-9549-62f826523020": "la-tourette-gc",
  "224c6ccb-9225-498d-89a4-9b65eaf39613": "silver-lake-golf-club",
  "dc593d4b-73c9-4c63-bf96-594d67b2a712": "douglaston-golf-course",
  "44598f72-c986-4aa0-bf42-fce542d79f34": "kissena-park-gc",
});

const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const knownLocale = (x: unknown): x is Locale => typeof x === "string" && Object.prototype.hasOwnProperty.call(dictionaries, x);

/**
 * Production-only secret shape: { [canonical UUID]: [[tee name, group,
 * Course Rating, Slope Rating], ...] }. No credentials, hole data, or raw
 * provider records. Reject incomplete wholesale replacements and ambiguity.
 */
export function readGolfCoreTeeSnapshot(raw: string | undefined): ReadonlyMap<string, ReviewedCourse> | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_BYTES) return null;
  try {
    const payload: unknown = JSON.parse(raw);
    if (!object(payload) || Object.keys(payload).length !== Object.keys(COURSE_SLUGS).length) return null;
    const output = new Map<string, ReviewedCourse>();
    for (const [courseId, tees] of Object.entries(payload)) {
      if (!isGolfCoreTeePilotCourse(courseId) || !Array.isArray(tees) || tees.length !== GOLFCORE_TEE_PILOT_ROW_COUNTS[courseId]) return null;
      const seen = new Set<string>();
      const typed: Tee[] = [];
      for (const rawTee of tees as unknown[]) {
        if (!Array.isArray(rawTee) || rawTee.length !== 4) return null;
        const [name, group, course, slope] = rawTee;
        if (typeof name !== "string" || !/^[A-Za-z]+(?:[ /-][A-Za-z]+)*$/.test(name) || name.length > 32 ||
            (group !== "men" && group !== "women") || typeof course !== "number" || course < 1 || course > 120 ||
            !Number.isInteger(course * 10) || !Number.isInteger(slope) || slope < 55 || slope > 155) return null;
        const key = name.toLowerCase() + ":" + group;
        if (seen.has(key)) return null;
        seen.add(key);
        typed.push([name, group, course, slope]);
      }
      output.set(courseId, { slug: COURSE_SLUGS[courseId], tees: typed });
    }
    return output;
  } catch {
    return null;
  }
}

export function parseGolfCoreTeePanelRequest(body: unknown): Request | null {
  if (!object(body) || Object.keys(body).length !== 2 || !isGolfCoreTeePilotCourse(body.courseId) || !knownLocale(body.locale)) return null;
  return { courseId: body.courseId, locale: body.locale };
}

export function isGolfCoreTeeSnapshotCurrent(now: number): boolean {
  return Number.isFinite(now) && now >= FIRST_VALID_MS && now < EXPIRY_MS;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const COLORS = new Map([
  ["black", "#111827"], ["blue", "#2563eb"], ["gold", "#eab308"],
  ["grey", "#6b7280"], ["orange", "#ea580c"], ["red", "#dc2626"],
  ["silver", "#94a3b8"], ["white", "#ffffff"],
]);
function swatch(name: string): string {
  const color = COLORS.get(name.toLowerCase());
  return color ? `<span class="swatch" aria-hidden="true" style="background:${color}"></span>` : "";
}

// Document only: one Course Details view, no JS, provider payload, raw
// structured records, download, aggregate, or client-side data API.
export const GOLFCORE_PANEL_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';";

export function renderGolfCoreTeePanel(data: ReviewedCourse, locale: Locale): string {
  const t = makeTranslator<TranslationKey>(dictionaries[locale], en);
  const text = (key: TranslationKey) => escapeHtml(t(key));
  const courseDate = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(FIRST_VALID_MS);
  const courseNumber = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const slopeNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const rows = data.tees.map(([name, group, course, slope]) => `<tr><th scope="row">${swatch(name)}${escapeHtml(name)}<small>${text(group === "men" ? "teeRatings.men" : "teeRatings.women")}</small></th><td>${courseNumber.format(course)}</td><td>${slopeNumber.format(slope)}</td></tr>`).join("");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${GOLFCORE_PANEL_CSP}"><meta name="robots" content="noindex,nofollow"><title>${text("teeRatings.title")}</title><style>
  *{box-sizing:border-box}body{margin:0;font:14px/1.35 system-ui,sans-serif;color:#334155;background:transparent}p{margin:0 0 8px}table{width:100%;border-collapse:collapse;table-layout:fixed}caption{text-align:left;font-weight:700;padding-bottom:8px}th,td{text-align:left;padding:6px 4px;border-bottom:1px solid #cbd5e1;overflow-wrap:anywhere}td{font-variant-numeric:tabular-nums;font-weight:700}thead{background:#f0f8f2;color:#173c27}thead th{font-size:12px}th:first-child{width:44%}small{display:block;font-size:11px;font-weight:400}.swatch{display:inline-block;width:11px;height:11px;border:1px solid #64748b;border-radius:3px;margin-inline-end:5px}a{color:#14532d;text-decoration:underline;font-weight:700}footer{margin-top:10px;font-size:12px}@media(prefers-color-scheme:dark){body{color:#e2e8f0}thead{background:#123624;color:#ecfdf5}th,td{border-color:#475569}a{color:#a7f3d0}}</style></head><body>
<table><caption>${text("teeRatings.eighteen")}</caption><thead><tr><th scope="col">${text("teeRatings.title")}</th><th scope="col">${text("teeRatings.course")}</th><th scope="col">${text("teeRatings.slope")}</th></tr></thead><tbody>${rows}</tbody></table>
<footer><p>${text("teeRatings.slopeScale")}</p><p>${text("teeRatings.explain")}</p><p><a href="${PUBLIC_URL}${escapeHtml(data.slug)}/" target="_blank" rel="noopener noreferrer">${ATTRIBUTION}</a> · ${escapeHtml(t("teeRatings.verified", { date: courseDate }))}</p></footer></body></html>`;
}
