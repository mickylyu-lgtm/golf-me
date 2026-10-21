import { describe, expect, it } from "vitest";
import { hasFoundingSpotsToShow, isInFoundingZone } from "./founder";

describe("hasFoundingSpotsToShow", () => {
  it("hides the count while loading or on error", () => {
    expect(hasFoundingSpotsToShow(null)).toBe(false);
  });
  it("shows remaining spots only for an open cohort with spots left", () => {
    expect(hasFoundingSpotsToShow({ cap: 250, awardedCount: 7, remaining: 243, isOpen: true })).toBe(true);
    expect(hasFoundingSpotsToShow({ cap: 250, awardedCount: 7, remaining: 0, isOpen: false })).toBe(false);
  });
  it("shows the claimed note once every spot is gone", () => {
    expect(hasFoundingSpotsToShow({ cap: 250, awardedCount: 250, remaining: 0, isOpen: false })).toBe(true);
  });
});

describe("isInFoundingZone (display mirror of the server zone)", () => {
  it("is true for NYC-area centroids and false elsewhere", () => {
    expect(isInFoundingZone({ lat: 40.71, lng: -74.01 })).toBe(true);
    expect(isInFoundingZone({ lat: 40.65, lng: -73.95 })).toBe(true);
    expect(isInFoundingZone({ lat: 35.69, lng: 139.69 })).toBe(false);
    expect(isInFoundingZone({ lat: 39.95, lng: -75.17 })).toBe(false);
    expect(isInFoundingZone(undefined)).toBe(false);
  });
});
