// Forward-looking scaffold, not wired into any UI yet. GolfMe's real course
// data now comes from two providers (courses + course_external_ids —
// geoapify for location discovery, golfcourseapi for name-based detail
// enrichment). Tee-time *availability* is a deliberately separate concern:
// golf_calls.tee_time_source stays locked to 'user_entered' at the database
// level (see 20260813050000_create_golf_calls_and_participants) until a real
// tee-time provider is actually integrated — this file exists so that when
// one is, it plugs into a common interface instead of being bolted onto
// GolfCall-hosting code directly.
//
// Hard constraints this interface is designed around (per explicit product
// direction): only authorized APIs/partner feeds/sandbox accounts, never
// scraping an authenticated member tee sheet, never automating login to a
// private club portal, never bypassing anti-bot/rate-limit/access controls.
// A TeeTimeProvider implementation that can't get real availability through
// a sanctioned API has no legitimate way to exist.

export interface TeeTimeSlot {
  id: string; // provider's own slot id
  dateISO: string;
  timeLabel: string;
  pricePerPerson: number | null;
  openSpots: number | null;
  bookingUrl: string | null;
}

export interface TeeTimeProvider {
  readonly name: string;
  // courseId is GolfMe's internal courses.id — a real implementation is
  // expected to resolve it to its own external id via course_external_ids
  // (the same mapping table course-enrich already populates), never invent
  // its own parallel course-identity scheme.
  getAvailability(courseId: string, dateISO: string): Promise<TeeTimeSlot[]>;
}

// Reference implementation proving the interface shape — deliberately
// returns nothing, never fake slots. A TeeTimeProvider that can't reach a
// real, authorized source must report "no data," the same honesty rule
// course-search/course-enrich already follow for course data.
export class MockTeeTimeProvider implements TeeTimeProvider {
  readonly name = "mock";

  async getAvailability(_courseId: string, _dateISO: string): Promise<TeeTimeSlot[]> {
    return [];
  }
}
