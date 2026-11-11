import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRegisteredUsers } from "../src/lib/adminUsers.ts";

const users = [
  { name: "Avery Golfer", username: "avery_golf", email: "Avery+Club@example.test" },
  { name: "Blair Smith", username: "blair", email: "blair@other.test" },
  { name: null, username: null, email: "onboarding@example.test" },
];

test("blank search preserves the whole roster and order", () => {
  assert.equal(filterRegisteredUsers(users, ""), users);
  assert.equal(filterRegisteredUsers(users, " \n\t "), users);
});

test("finds name, username with or without @, and registered email case-insensitively", () => {
  for (const query of ["avery", "GOLFER", "@AVERY_GOLF", " avery_golf ", "AVERY+CLUB@EXAMPLE.TEST", "+club"]) {
    assert.deepEqual(filterRegisteredUsers(users, query), [users[0]]);
  }
});

test("matches email domain across the full roster, including incomplete onboarding", () => {
  assert.deepEqual(filterRegisteredUsers(users, "@example.test"), [users[0], users[2]]);
  assert.deepEqual(filterRegisteredUsers(users, "onboarding"), [users[2]]);
});

test("multiple words may match different identity fields", () => {
  assert.deepEqual(filterRegisteredUsers(users, "  GOLFER \t +Club  "), [users[0]]);
  assert.deepEqual(filterRegisteredUsers(users, "Avery other.test"), []);
});

test("punctuation is treated literally, never as a regex", () => {
  assert.deepEqual(filterRegisteredUsers(users, ".*"), []);
  assert.deepEqual(filterRegisteredUsers(users, "["), []);
  assert.deepEqual(filterRegisteredUsers(users, "@"), users);
});

test("search happens before display pagination and does not mutate the source", () => {
  const roster = Array.from({ length: 230 }, (_, index) => ({
    name: "Golfer " + index, username: null, email: "golfer" + index + "@example.test",
  }));
  const original = structuredClone(roster);
  assert.deepEqual(filterRegisteredUsers(roster, "golfer229@"), [roster[229]]);
  assert.deepEqual(roster, original);
});

test("empty roster and unmatched search return no results", () => {
  assert.deepEqual(filterRegisteredUsers([], "example"), []);
  assert.deepEqual(filterRegisteredUsers(users, "missing"), []);
});
