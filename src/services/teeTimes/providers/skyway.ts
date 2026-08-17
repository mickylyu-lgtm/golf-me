import type { TeeTime, TeeTimeProvider } from "../types";

// Skyway Golf Course at Lincoln Park West books through Lightspeed Golf
// (formerly Chronogolf) — confirmed live: skywaygolfcourse.com's own
// "Members Area" link points at members.chronogolf.com. Lightspeed does
// publish an official Partner API (https://partner-api.docs.chronogolf.com/)
// that can read a real tee sheet, but it's explicitly partner-gated —
// approval + credentials from Lightspeed, not a public/anonymous API.
// GolfMe doesn't have that relationship yet, so getTeeTimes() honestly
// returns nothing rather than scraping the (bot-protected) booking site,
// which would violate the no-anti-bot-bypass constraint this was built
// under. Update this file, not the UI, the day real credentials exist.
const BOOKING_URL = "https://www.chronogolf.com/club/skyway-golf-course";

export const skywayProvider: TeeTimeProvider = {
  name: "lightspeed-golf",

  async getTeeTimes(): Promise<TeeTime[]> {
    return [];
  },

  getBookingUrl(): string {
    return BOOKING_URL;
  },
};
