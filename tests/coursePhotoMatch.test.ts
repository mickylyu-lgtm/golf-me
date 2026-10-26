// Run: npm run test:courses  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { articleMatchesCourse, commonsFileMatchesCourse, distinctiveWords, isCommonsUrl, plainArtist } from "../src/lib/coursePhotoMatch.ts";

test("distinctive words drop generic golf and place words", () => {
  assert.deepEqual(distinctiveWords("Dyker Beach Golf Course"), ["dyker", "beach"]);
  assert.deepEqual(distinctiveWords("The Golf Club of New York"), []);
});

test("an article is used only when it names the course and is about golf", () => {
  assert.equal(articleMatchesCourse("Dyker Beach Golf Course", "Dyker Beach Park and Golf Course", "Dyker_Beach_Golf_Course.JPG"), true);
  assert.equal(articleMatchesCourse("Bethpage Black Course", "Bethpage State Park", "Bethpage-golf1.jpg"), true);
  // Names the course's park, but the photo is the park in winter.
  assert.equal(articleMatchesCourse("Marine Park Golf Course", "Marine Park (Brooklyn park)", "MarineParkWinter.jpg"), false);
  // About golf, but a different course.
  assert.equal(articleMatchesCourse("Clearview Park Golf Course", "Van Cortlandt Golf Course", "VC.jpg"), false);
  // A course name with nothing distinctive never matches by name.
  assert.equal(articleMatchesCourse("Golf Club", "Some Golf Club", "golf.jpg"), false);
});

test("a nearby Commons file must say golf and not name another place", () => {
  assert.equal(commonsFileMatchesCourse("Split Rock Golf Course", "File:Pelham Split Rock golf club jeh.JPG"), true);
  assert.equal(commonsFileMatchesCourse("Split Rock Golf Course", "File:Golf course 2014.jpg"), true);
  assert.equal(commonsFileMatchesCourse("Split Rock Golf Course", "File:Pelham Bay Park playground.jpg"), false);
  assert.equal(commonsFileMatchesCourse("Split Rock Golf Course", "File:Mosholu golf course clubhouse.jpg"), false);
});

test("only Commons-hosted files", () => {
  assert.equal(isCommonsUrl("https://upload.wikimedia.org/wikipedia/commons/b/b0/Dyker_Beach_Golf_Course.JPG"), true);
  assert.equal(isCommonsUrl("https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/Bethpage-golf1.jpg/960px-Bethpage-golf1.jpg"), true);
  assert.equal(isCommonsUrl("https://upload.wikimedia.org/wikipedia/en/0/0b/House.gif"), false);
});

test("artist HTML becomes plain text", () => {
  assert.equal(plainArtist('<a href="x">cjz208</a> at <a href="y">English Wikipedia</a>'), "cjz208 at English Wikipedia");
  assert.equal(plainArtist(""), undefined);
});
