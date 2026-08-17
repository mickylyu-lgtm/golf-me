// GolfMe's tee-time system is deliberately restricted to two courses for
// now (see index.ts) rather than tied to the general courses/
// course_external_ids table the rest of the app uses — this is a narrow,
// hand-verified integration, not a scaled-up version of course search.

export interface SupportedTeeTimeCourse {
  id: string;
  name: string;
  city: string;
  state: string;
  holes: 9 | 18;
}

export const SUPPORTED_TEE_TIME_COURSES: SupportedTeeTimeCourse[] = [
  {
    id: "skyway",
    name: "Skyway Golf Course at Lincoln Park West",
    city: "Jersey City",
    state: "NJ",
    holes: 9,
  },
  {
    id: "dyker-beach",
    name: "Dyker Beach Golf Course",
    city: "Brooklyn",
    state: "NY",
    holes: 18,
  },
];

export interface TeeTime {
  id: string;
  courseId: string;
  courseName: string;
  date: string; // ISO date, e.g. "2026-08-25"
  time: string; // e.g. "10:20 AM"

  price?: number;
  currency?: string;

  holes: 9 | 18;

  availableSpots?: number;

  provider: string;

  bookingUrl: string;

  lastUpdated: string; // ISO timestamp
}

// Selection lifecycle — picking a tee time in GolfMe is never itself a
// booking. "selected" -> chosen in GolfMe; "booking_started" -> the user
// tapped through to the official site; "user_confirmed_booked" -> the user
// came back and manually said "I booked this." GolfMe has no booking-
// confirmation API for either provider, so this status can never be set
// automatically — see Step 12 of the brief this shipped against.
export type TeeTimeStatus = "selected" | "booking_started" | "user_confirmed_booked";

export interface SelectedTeeTime {
  courseId: string;
  courseName: string;
  date: string;
  time: string;
  holes: number;
  price?: number;
  bookingUrl: string;
  provider: string;
}

// Every provider must implement this the same way: getTeeTimes() returns a
// real, live slot list or an empty array — never a fabricated one — and
// getBookingUrl() always points at the course's real official booking
// destination, live availability or not. See providers/skyway.ts and
// providers/dykerBeach.ts for why getTeeTimes() returns [] for both today
// (no public API exists for either provider; both require an approved
// partner-API relationship GolfMe doesn't have yet).
export interface TeeTimeProvider {
  readonly name: string;
  getTeeTimes(params: { courseId: string; date: string }): Promise<TeeTime[]>;
  getBookingUrl(params: { courseId: string; date?: string }): string;
}
