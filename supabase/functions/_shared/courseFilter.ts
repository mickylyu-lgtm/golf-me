// Which Geoapify "sport.golf_course" features are real golf courses that
// people can play a round on. Shared by the course-search Edge Function
// (Deno) and the web client (src/lib/realCourseSearch.ts), so this file must
// stay pure TypeScript with no imports.
//
// Order of evidence, strongest first:
//   1. No name -> never shown. Geoapify gives unnamed features a street
//      address in address_line1 ("Ho Chung Road"); that is not a course name.
//   2. Structured OpenStreetMap tags (properties.datasource.raw) and
//      Geoapify categories: miniature golf, driving ranges, indoor/screen
//      golf and other non-course leisure features.
//   3. Name keywords, as a last resort, in English, Chinese, Japanese and
//      Korean. A driving-range keyword is ignored when the name also says it
//      is a course or club and joins the two ("... Golf Club & Driving Range"
//      stays). Without a joiner the range belongs to the club ("珀麗高爾夫球會
//      高爾夫球練習場" is the Golf Park club's range) and is dropped.
//
// Bias: keep when unsure. Hiding a real course is worse than showing a range.

export interface GeoapifyCourseFeatureProps {
  name?: string;
  categories?: string[];
  datasource?: { raw?: Record<string, unknown> };
}

export type CourseRejectReason = "unnamed" | "miniature_golf" | "driving_range" | "not_a_course" | "name_keyword";

function tag(raw: Record<string, unknown> | undefined, key: string): string {
  const v = raw?.[key];
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

// OSM values may be semicolon lists ("golf_course;miniature_golf").
function tagValues(raw: Record<string, unknown> | undefined, key: string): string[] {
  return tag(raw, key)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const MINI_TAG_VALUES = new Set(["miniature_golf", "miniature", "minigolf", "mini_golf", "mini", "crazy_golf", "adventure_golf", "putt_putt"]);
const RANGE_TAG_VALUES = new Set(["driving_range", "practice", "practice_range", "range", "indoor", "simulator", "screen_golf", "putting_green"]);

// leisure values that can legitimately sit on a playable course feature.
// Anything else (sports_centre, pitch, fitness_centre, miniature_golf, park,
// ...) with a golf sport is a range, simulator venue or putting area.
const COURSE_LEISURE_VALUES = new Set(["golf_course"]);

/** Name keywords that mean miniature golf. Always excluded. */
const MINI_NAME_PATTERNS: RegExp[] = [
  /\bmini[\s-]?golf/i,
  /\bminiature[\s-]?golf/i,
  /\bcrazy[\s-]?golf/i,
  /\badventure[\s-]?golf/i,
  /\bputt[\s-]?putt/i,
  /\bmini[\s-]?putt/i,
  /迷你高[爾尔]夫/,
  /小型高[爾尔]夫/,
  /ミニゴルフ/,
  /パターゴルフ/,
  /미니\s?골프/,
];

/** Name keywords that mean a driving range, practice or simulator venue. */
const RANGE_NAME_PATTERNS: RegExp[] = [
  /\bdriving[\s-]?range/i,
  /\bgolf[\s-]?range\b/i,
  /\bpractice[\s-]?(range|centre|center|ground|facility)/i,
  /\bgolf[\s-]?practice/i,
  /\bindoor[\s-]?golf/i,
  /\bgolf[\s-]?simulat/i,
  /\bscreen[\s-]?golf/i,
  /\btop[\s-]?golf\b/i,
  /練習場/,
  /练习场/,
  /高[爾尔]夫(球)?練習/,
  /高[爾尔]夫(球)?练习/,
  /打ちっぱなし/,
  /打ち放し/,
  /打ちっ放し/,
  /ドライビングレンジ/,
  /ゴルフレンジ/,
  /연습장/,
  /스크린\s?골프/,
  /실내\s?골프/,
];

/** Name keywords that say "this is a course/club" and protect it from the
 * range keywords above (not from the miniature-golf ones). */
const COURSE_NAME_PATTERNS: RegExp[] = [
  /\bgolf[\s-]?(club|course|links|resort|and country club|& country club)\b/i,
  /\bcountry[\s-]?club\b/i,
  /\bg\.?\s?c\.?$/i,
  /\bc\.?\s?c\.?$/i,
  /高[爾尔]夫球?[會会]/,
  /高[爾尔]夫(球)?[場场]/,
  /高[爾尔]夫(俱樂部|俱乐部)/,
  /ゴルフ(場|クラブ|倶楽部|コース|リンクス)/,
  /カントリー(クラブ|倶楽部)/,
  /골프(장|클럽|코스)/,
  /컨트리\s?클럽/,
];

/** "&", "and" and their CJK equivalents: a name that pairs a course with a
 * range ("Golf Club & Driving Range") rather than naming a club's range. */
const COURSE_AND_RANGE_JOINER = /&|＆|\+|\band\b|與|与|及|和|및/i;

function matchesAny(patterns: RegExp[], s: string): boolean {
  return patterns.some((p) => p.test(s));
}

/** Name-only check, usable where structured tags aren't available (the web
 * client only sees cached course rows). Returns null when the name looks
 * like a playable course. */
export function rejectCourseByName(name: string | null | undefined): CourseRejectReason | null {
  const n = (name ?? "").trim();
  if (!n) return "unnamed";
  // The old course-search fallback label for a feature with no name.
  if (/^unnamed course$/i.test(n)) return "unnamed";
  if (matchesAny(MINI_NAME_PATTERNS, n)) return "miniature_golf";
  if (matchesAny(RANGE_NAME_PATTERNS, n) && !(matchesAny(COURSE_NAME_PATTERNS, n) && COURSE_AND_RANGE_JOINER.test(n))) return "name_keyword";
  return null;
}

/** The display name for a Geoapify feature, or "" when it has none. Never
 * falls back to address_line1 (a street address for unnamed features). */
export function geoapifyCourseName(p: GeoapifyCourseFeatureProps): string {
  const fromProps = p.name?.trim();
  if (fromProps) return fromProps;
  const raw = p.datasource?.raw;
  for (const key of ["name", "name:en"]) {
    const v = raw?.[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Full check for a Geoapify Places feature. Returns null to keep it. */
export function rejectGeoapifyCourse(p: GeoapifyCourseFeatureProps): CourseRejectReason | null {
  const name = geoapifyCourseName(p);
  if (!name) return "unnamed";

  const raw = p.datasource?.raw;
  const categories = p.categories ?? [];
  const leisure = tagValues(raw, "leisure");
  const golf = tagValues(raw, "golf");
  const golfCourse = tagValues(raw, "golf_course");
  const sport = tagValues(raw, "sport");

  if (leisure.includes("miniature_golf") || raw?.["miniature_golf"] != null) return "miniature_golf";
  if (golf.some((v) => MINI_TAG_VALUES.has(v)) || golfCourse.some((v) => MINI_TAG_VALUES.has(v))) return "miniature_golf";
  if (sport.some((v) => v === "miniature_golf" || v === "minigolf")) return "miniature_golf";
  // Geoapify's own miniature-golf category, unless OSM clearly says course.
  if (categories.includes("entertainment.miniature_golf") && !leisure.includes("golf_course")) return "miniature_golf";

  if (golf.some((v) => RANGE_TAG_VALUES.has(v)) || golfCourse.some((v) => RANGE_TAG_VALUES.has(v))) return "driving_range";
  if (tag(raw, "driving_range") === "only") return "driving_range";

  // A golf feature whose leisure tag is something other than a course
  // (sports_centre = ranges and screen-golf venues, pitch = practice areas).
  if (leisure.length > 0 && !leisure.some((v) => COURSE_LEISURE_VALUES.has(v))) return "not_a_course";

  return rejectCourseByName(name);
}

// Street-address names that the old course-search fallback cached for
// unnamed features ("Ho Chung Road", "Shing Mun Catchwater"). Only used by
// the web client while it is talking to a course-search deployment that
// predates this filter (no `courseFilter` marker in the response), since a
// client can't otherwise tell an address from a name.
const GOLFISH_NAME = /golf|links|country\s?club|\bclub\b|\bcourse\b|\bcc\b|\bgc\b|高[爾尔]夫|球[場场]|球[會会]|ゴルフ|カントリー|倶楽部|골프|컨트리|클럽/i;
const STREETISH_NAME =
  /(\b(road|rd|street|st|avenue|ave|lane|ln|drive|dr|boulevard|blvd|highway|hwy|expressway|catchwater|path|trail|close|crescent|terrace)\.?$)|(^\d+[\w-]*\s)|([路街道]$)|(通り$)|((로|길)$)/i;

export function looksLikeStreetAddressName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n || GOLFISH_NAME.test(n)) return false;
  return STREETISH_NAME.test(n);
}

/** Response marker the course-search function sets once it applies this
 * filter server-side. */
export const COURSE_FILTER_VERSION = 1;
