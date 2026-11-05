// Pure matching rules for course photos from Wikimedia (see coursePhotos.ts).
// Kept separate so the rules are testable without a browser.
//
// A wrong photo is worse than no photo: when in doubt, return nothing and the
// row keeps its satellite view.

// Words that say "golf course" but not WHICH one, so they never count as a
// name match on their own.
const GENERIC_WORDS = new Set([
  "golf", "course", "courses", "club", "country", "cc", "gc", "links", "the", "and", "of", "at",
  "park", "state", "municipal", "public", "national", "resort", "hotel", "spa", "executive",
  "center", "centre", "range", "driving", "par", "3", "9", "18", "hole", "holes",
  "north", "south", "east", "west", "new", "york", "nyc", "ny", "nj", "brooklyn", "queens", "bronx",
  "manhattan", "staten", "island", "long", "&",
]);

export function distinctiveWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9&]+/)
    .filter((w) => w.length > 1 && !GENERIC_WORDS.has(w));
}

// Words a facility uses to tell its own courses apart (Bethpage Black vs
// Red, Eisenhower Park White vs Red, 9 vs 18): when both names carry one,
// they must share it, or it's a sibling course's photo.
const DISTINGUISHING = new Set(["black", "red", "blue", "green", "gold", "white", "yellow", "orange", "silver", "bronze", "lower", "upper"]);

function distinguishingWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => DISTINGUISHING.has(w) || /^\d+$/.test(w)),
  );
}

/** Both names pick out a course at a facility, and not the same one. */
export function namesASiblingCourse(courseName: string, other: string): boolean {
  const a = distinguishingWords(courseName);
  const b = distinguishingWords(other);
  return a.size > 0 && b.size > 0 && ![...a].some((w) => b.has(w));
}

function sharesDistinctiveWord(courseName: string, other: string): boolean {
  if (namesASiblingCourse(courseName, other)) return false;
  const mine = distinctiveWords(courseName);
  if (mine.length === 0) return false;
  const theirs = new Set(distinctiveWords(other));
  return mine.some((w) => theirs.has(w));
}

const GOLF_HINT = /golf|country club|links/i;

/** A Wikipedia article (found near the course) whose lead image is used:
 * its title must name this course, and either the title or the image file
 * must be about golf (so "Marine Park" with a winter park photo is out). */
export function articleMatchesCourse(courseName: string, articleTitle: string, imageFile: string): boolean {
  if (!sharesDistinctiveWord(courseName, articleTitle)) return false;
  return GOLF_HINT.test(articleTitle) || /golf/i.test(imageFile);
}

/** A geotagged Commons photo near the course: its file name must say golf,
 * and if it names a place, that place must be this course. */
export function commonsFileMatchesCourse(courseName: string, fileTitle: string): boolean {
  if (!/golf/i.test(fileTitle)) return false;
  if (sharesDistinctiveWord(courseName, fileTitle)) return true;
  // No shared name: only a file that names no place at all ("Golf course
  // 2014.jpg", "IMG_1234 golf green.jpg"). One naming some other course or
  // town is out.
  const base = fileTitle.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
  return distinctiveWords(base).every((w) => PHOTO_WORDS.has(w) || /\d/.test(w));
}

// Words a photo's file name uses without naming a place.
const PHOTO_WORDS = new Set([
  "img", "dsc", "dscn", "photo", "pic", "view", "green", "greens", "tee", "fairway", "bunker", "clubhouse",
  "flag", "pin", "sunset", "sunrise", "summer", "winter", "spring", "autumn", "fall", "aerial", "from", "in",
  "on", "with", "near", "jeh",
]);

/** Only photos hosted on Wikimedia Commons (freely licensed, with license
 * metadata). Files local to one Wikipedia can be non-free "fair use". */
export function isCommonsUrl(url: string): boolean {
  return /^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(url);
}

// Does a photo show the course itself (Micky, 2026-11-05: "showcase the
// courses so users know what the course is like")? Judged from the file
// title, description and categories, since a photo of a golf club is often
// its clubhouse, sign, logo or car park. Refused outright: those, maps and
// plans, and non-photo formats (SVG/PNG are mostly logos, maps, diagrams).
const NOT_THE_COURSE =
  /\b(logos?|maps?|plans?|diagrams?|layout map|score ?cards?|signs?|signage|plaques?|seals?|crests?|emblems?|badges?|banners?|clubhouses?|club ?house|entrances?|gates?|parking|car ?park|lobby|restaurant|bar|interiors?|menu|trophy|trophies|portrait|headshot|award|ceremony|press conference|locator)\b/i;
// What a course photo is usually titled or categorised as.
// "golf" without a trailing boundary, so "Bethpage-golf1.jpg" counts.
const SHOWS_THE_COURSE = /\bholes?\b|\b\d+(st|nd|rd|th) hole|\bfairways?\b|\bgreens?\b|\btees?\b|\bbunkers?\b|\baerial|\blinks\b|golf|\bcourse\b/i;
const PHOTO_EXT = /\.(jpe?g|webp|tiff?)$/i;

export interface PhotoText {
  title: string;
  description?: string | null;
  categories?: string | null;
}

/** -1: not the course (logo, sign, clubhouse, map, non-photo). Otherwise
 * how many course words the title/description/categories carry; the title
 * counts double, so "Hole 4 fairway.jpg" beats a file only categorised as
 * golf. A photo is used only with a score >= 1. */
export function photoCourseScore(p: PhotoText): number {
  const title = p.title.replace(/^File:/i, "");
  if (!PHOTO_EXT.test(title)) return -1;
  const words = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/[_.|-]+/g, " ");
  const all = `${words(title)} ${words(p.description ?? "")} ${words(p.categories ?? "")}`;
  if (NOT_THE_COURSE.test(all)) return -1;
  const count = (s: string) => (words(s).match(new RegExp(SHOWS_THE_COURSE.source, "gi")) ?? []).length;
  return count(title) * 2 + count(`${p.description ?? ""} ${p.categories ?? ""}`);
}

export function photoShowsCourse(p: PhotoText): boolean {
  return photoCourseScore(p) >= 1;
}

// Commons' LicenseShortName values we accept. Commons only hosts free
// files, but the short name is free text, so anything we can't read is
// refused rather than guessed. NC/ND never pass (not on Commons anyway).
export type CommonsLicenseClass = "cc0" | "pd" | "cc-by" | "cc-by-sa" | "gfdl";

export function classifyCommonsLicense(shortName: string | undefined | null): CommonsLicenseClass | null {
  if (!shortName) return null;
  const s = shortName.trim().toLowerCase();
  if (!s) return null;
  if (/\b(nc|nd)\b|non-?commercial|no-?deriv/.test(s)) return null;
  if (/^cc0\b|^cc-zero\b|cc0 1\.0/.test(s)) return "cc0";
  if (/^public domain\b|^pd\b|^pd-/.test(s)) return "pd";
  if (/^cc[ -]by[ -]sa\b/.test(s)) return "cc-by-sa";
  if (/^cc[ -]by\b(?![ -]sa)/.test(s)) return "cc-by";
  if (/^gfdl\b/.test(s)) return "gfdl";
  return null;
}

/** May GolfMe make a derivative (an AI clip) from a file under this
 * license? CC0, public domain, CC BY, CC BY-SA (the clip then has to be
 * shared under CC BY-SA too). GFDL is free but needs the full license text
 * shipped with every copy, so it's display-only here. */
export function licenseAllowsDerivatives(cls: CommonsLicenseClass | null): boolean {
  return cls === "cc0" || cls === "pd" || cls === "cc-by" || cls === "cc-by-sa";
}

export function licenseIsShareAlike(cls: CommonsLicenseClass | null): boolean {
  return cls === "cc-by-sa";
}

/** Strips the HTML Commons puts in its Artist field down to plain text. */
export function plainArtist(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 80) : undefined;
}
