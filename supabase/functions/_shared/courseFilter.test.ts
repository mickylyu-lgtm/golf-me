// Run: npm run test:courses  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { geoapifyCourseName, looksLikeStreetAddressName, rejectCourseByName, rejectGeoapifyCourse } from "./courseFilter.ts";

const course = (name: string | undefined, raw: Record<string, unknown> = { leisure: "golf_course" }, categories = ["sport", "sport.golf_course"]) => ({
  name,
  categories,
  datasource: { raw: name ? { name, ...raw } : raw },
});

test("unnamed features are dropped, never named after their street", () => {
  // Geoapify puts the street in address_line1 for these; the filter ignores it.
  assert.equal(rejectGeoapifyCourse({ ...course(undefined), address_line1: "Ho Chung Road" } as never), "unnamed");
  assert.equal(rejectGeoapifyCourse(course("   ")), "unnamed");
  assert.equal(geoapifyCourseName({ datasource: { raw: { "name:en": "Shek O Golf Club" } } }), "Shek O Golf Club");
});

test("real courses stay", () => {
  for (const n of [
    "Clearwater Bay Golf & Country Club",
    "The Hong Kong Golf Club",
    "Kau Sai Chau Public Golf Course",
    "香港哥爾夫球會",
    "滘西洲公眾高爾夫球場",
    "Discovery Bay Golf Club",
    "Pebble Beach Golf Links",
    "Augusta National",
    "Old Course",
    "霞ヶ関カンツリー倶楽部",
    "小金井カントリー倶楽部",
    "남서울 컨트리클럽",
    "Sky72 골프클럽",
    "Bethpage Black",
    "Kiawah Island Ocean Course",
  ]) {
    assert.equal(rejectGeoapifyCourse(course(n)), null, n);
  }
  // No raw tags at all (datasource missing): name-only fallback keeps it.
  assert.equal(rejectGeoapifyCourse({ name: "Fanling Golf Course" }), null);
  // A club tagged as an organisation rather than a course area still stays.
  assert.equal(rejectGeoapifyCourse(course("Shek O Country Club", { club: "sport", sport: "golf" })), null);
  // A course whose name mentions its range is still a course.
  assert.equal(rejectGeoapifyCourse(course("Riverside Golf Club & Driving Range")), null);
  assert.equal(rejectGeoapifyCourse(course("Riverside Golf Club and Practice Range")), null);
  assert.equal(rejectGeoapifyCourse(course("河畔高爾夫球會及練習場")), null);
  assert.equal(rejectGeoapifyCourse(course("Pitch and Putt at Lakeside", { leisure: "golf_course", golf_course: "pitch_and_putt" })), null);
});

test("miniature golf is dropped by tags, category or name", () => {
  assert.equal(rejectGeoapifyCourse(course("Shek O Mini Golf", { leisure: "miniature_golf" })), "miniature_golf");
  assert.equal(rejectGeoapifyCourse(course("Fun Putt", { leisure: "golf_course", golf: "miniature" })), "miniature_golf");
  assert.equal(rejectGeoapifyCourse(course("Fun Putt", {}, ["entertainment.miniature_golf", "sport.golf_course"])), "miniature_golf");
  assert.equal(rejectGeoapifyCourse(course("石澳小型高爾夫球場")), "miniature_golf");
  assert.equal(rejectGeoapifyCourse(course("Adventure Golf Island")), "miniature_golf");
  assert.equal(rejectGeoapifyCourse(course("ミニゴルフ場")), "miniature_golf");
  assert.equal(rejectGeoapifyCourse(course("미니골프")), "miniature_golf");
});

test("driving ranges, simulators and practice areas are dropped", () => {
  assert.equal(rejectGeoapifyCourse(course("Some Range", { leisure: "golf_course", golf: "driving_range" })), "driving_range");
  assert.equal(rejectGeoapifyCourse(course("Some Range", { leisure: "golf_course", golf_course: "driving_range" })), "driving_range");
  assert.equal(rejectGeoapifyCourse(course("Golf Zone", { leisure: "sports_centre", sport: "golf" })), "not_a_course");
  assert.equal(rejectGeoapifyCourse(course("Putting Area", { leisure: "pitch", sport: "golf" })), "not_a_course");
  for (const n of [
    "高爾夫球練習場 Jockey Club Kau Sai Chau Golf driving range",
    "City Golf Driving Range",
    "屯門高爾夫球練習場",
    "深圳高尔夫练习场",
    "新宿ゴルフ練習場",
    "打ちっぱなしゴルフ",
    "ドライビングレンジ横浜",
    "강남 골프연습장",
    "스크린골프 존",
    "Topgolf Las Vegas",
    // A club's own range: the club word doesn't protect it without "&"/"and".
    "珀麗高爾夫球會高爾夫球練習場 Golf Park Driving Range",
    "珀麗高爾夫球會高爾夫球練習場",
    "Sunset Golf Club Driving Range",
  ]) {
    assert.notEqual(rejectGeoapifyCourse(course(n)), null, n);
  }
});

test("client name guard", () => {
  assert.equal(rejectCourseByName("Unnamed course"), "unnamed");
  assert.equal(rejectCourseByName(""), "unnamed");
  assert.equal(rejectCourseByName("The Hong Kong Golf Club"), null);
  assert.equal(rejectCourseByName("石澳小型高爾夫球場"), "miniature_golf");
});

test("street-address names from the old fallback (pre-filter server only)", () => {
  for (const n of ["Ho Chung Road", "Pak Kong Road", "Shing Mun Catchwater", "12 Main St", "西貢公路", "彌敦道"]) {
    assert.equal(looksLikeStreetAddressName(n), true, n);
  }
  for (const n of ["Clearwater Bay Golf & Country Club", "Augusta National", "Old Course", "Fairway", "Pine Valley", "Shinnecock Hills", "Golf Road Club", "北海道クラシックゴルフクラブ"]) {
    assert.equal(looksLikeStreetAddressName(n), false, n);
  }
});
