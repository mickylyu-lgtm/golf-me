import type { TeeTime, TeeTimeProvider } from "../types";

// Dyker Beach Golf Course is one of the 6 NYC courses operated by American
// Golf and books through "Tee It Up" (NBC Sports Next) behind the scenes,
// but per explicit instruction the user-facing link points at the
// course's own official site instead — dykerbeachgc.com's own booking
// page ultimately routes there anyway, and this is the URL confirmed as
// correct. No public Tee It Up API was found; its real booking pages are
// JS-rendered and sit behind bot protection that returned a flat 403 to a
// plain server-side fetch during research, so scraping them would mean
// bypassing anti-bot protection — explicitly out of bounds. getTeeTimes()
// honestly returns nothing until GolfMe has a real, authorized
// integration (a Tee It Up / NBC Sports Next partner API, if and when one
// becomes available).
const BOOKING_URL = "https://www.dykerbeachgc.com/";

export const dykerBeachProvider: TeeTimeProvider = {
  name: "tee-it-up",

  async getTeeTimes(): Promise<TeeTime[]> {
    return [];
  },

  getBookingUrl(): string {
    return BOOKING_URL;
  },
};
