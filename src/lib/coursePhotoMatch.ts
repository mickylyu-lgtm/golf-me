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

function sharesDistinctiveWord(courseName: string, other: string): boolean {
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

/** Strips the HTML Commons puts in its Artist field down to plain text. */
export function plainArtist(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 80) : undefined;
}
