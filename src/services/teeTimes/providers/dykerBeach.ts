import type { TeeTime, TeeTimeProvider } from "../types";

// Dyker Beach Golf Course is one of the 6 NYC courses operated by American
// Golf and booked through "Tee It Up" (NBC Sports Next) — confirmed live:
// dykerbeachgc.com's own "Book Tee Times Online" button points at the NYC
// American Golf Tee It Up site. No public API was found; Tee It Up's real
// booking pages are JS-rendered and sit behind bot protection that returned
// a flat 403 to a plain server-side fetch during research, so scraping them
// would mean bypassing anti-bot protection — explicitly out of bounds.
// getTeeTimes() honestly returns nothing until GolfMe has a real,
// authorized integration (a Tee It Up / NBC Sports Next partner API, if
// and when one becomes available).
const BOOKING_URL = "https://new-york-american-golf.book.teeitup.com/";

export const dykerBeachProvider: TeeTimeProvider = {
  name: "tee-it-up",

  async getTeeTimes(): Promise<TeeTime[]> {
    return [];
  },

  getBookingUrl(): string {
    return BOOKING_URL;
  },
};
