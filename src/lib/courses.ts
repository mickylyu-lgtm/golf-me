// Canonical course list for the prototype — every course referenced across
// mock golfers and Golf Calls, plus a couple extra for a richer search.
// Swap for a real course-data API later without touching callers.
export const COURSES: string[] = [
  "Bethpage Black",
  "Bethpage Blue",
  "Bethpage Red",
  "Cantiague Park Golf Course",
  "Cherry Valley Club",
  "Eisenhower Park Red",
  "Eisenhower Park White",
  "Forest Park Golf Course",
  "Harbor Links Golf Course",
  "Liberty National",
  "Salisbury Red Course",
  "Split Rock Golf Course",
  "Van Cortlandt Park Golf Course",
].sort();

// Display-only area label per course, for contexts (like a Community course
// tag) that want to show "Course · Area" without a real course-data table.
// Not a second course record — COURSES above is still the only source of
// truth for which courses exist.
const COURSE_AREAS: Record<string, string> = {
  "Bethpage Black": "Farmingdale, NY",
  "Bethpage Blue": "Farmingdale, NY",
  "Bethpage Red": "Farmingdale, NY",
  "Cantiague Park Golf Course": "Hicksville, NY",
  "Cherry Valley Club": "Garden City, NY",
  "Eisenhower Park Red": "East Meadow, NY",
  "Eisenhower Park White": "East Meadow, NY",
  "Forest Park Golf Course": "Queens, NY",
  "Harbor Links Golf Course": "Port Washington, NY",
  "Liberty National": "Jersey City, NJ",
  "Salisbury Red Course": "East Meadow, NY",
  "Split Rock Golf Course": "Bronx, NY",
  "Van Cortlandt Park Golf Course": "Bronx, NY",
};

export function areaForCourse(course: string): string | undefined {
  return COURSE_AREAS[course];
}
