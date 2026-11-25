// Hand-verified course imagery. These two courses were once GolfMe's Tee
// Times integration (removed 2026-11-16); what remains is their real,
// legitimately licensed hero photos, which course thumbnails and the course
// page still prefer over generic imagery.

export interface HandpickedCourse {
  id: string;
  name: string;
  // Real, legitimately-licensed course photo, only ever set here by hand
  // after verifying a real source and its license. CourseHero falls back to
  // a generic illustration when this is absent, never a fake "photo".
  heroImageUrl?: string;
  heroImageKind?: "photo" | "satellite";
  roundPhoto?: { url: string; credit: string; sourceUrl: string; licenseUrl: string };
  heroImageCredit?: string; // shown alongside the image, per its license's attribution requirement
}

export const HANDPICKED_COURSES: HandpickedCourse[] = [
  {
    id: "skyway",
    // Exact-course photo verified via Commons; Home rounds only. Adaptation
    // remains CC BY-SA 4.0; source, attribution, crop and license are linked.
    roundPhoto: {
      url: "/courses/skyway-round-photo.webp",
      credit: "Photo: King of Hearts · CC BY-SA 4.0 (cropped)",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Lincoln_Park_Jersey_City_September_2021_012.jpg",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    name: "Skyway Golf Course",
    // Real aerial: USGS NAIP orthoimagery, public domain (US federal work),
    // exported 2026-10-23 from imagery.nationalmap.gov.
    heroImageUrl: "/courses/skyway-aerial.jpg",
    heroImageKind: "satellite",
    heroImageCredit: "Aerial: USGS NAIP (public domain)",
  },
  {
    id: "dyker-beach",
    name: "Dyker Beach Golf Course",
    // Wikidata Q5318678 P18: Wikimedia Commons file, CC BY-SA 3.0,
    // attributed to cjz208 on English Wikipedia.
    heroImageUrl: "https://upload.wikimedia.org/wikipedia/commons/b/b0/Dyker_Beach_Golf_Course.JPG",
    heroImageKind: "photo",
    heroImageCredit: "Photo: cjz208 / Wikimedia Commons (CC BY-SA 3.0)",
  },
];

function normalizeCourseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Matches a course-search result to a hand-picked course by name only (the
// ids are unrelated). Exact match after normalizing, so a random nearby
// course is never shown with another course's photo.
export function matchHandpickedCourse(name: string): HandpickedCourse | undefined {
  const normalized = normalizeCourseName(name);
  return HANDPICKED_COURSES.find((c) => normalizeCourseName(c.name) === normalized);
}
