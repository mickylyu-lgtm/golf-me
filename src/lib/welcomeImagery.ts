// The sign-in welcome screen's photo, in one place so the course-imagery
// work can swap it without touching the screen (src/pages/Auth.tsx).
//
// width/height are the file's real pixel size (the screen reserves a fixed
// band, so they only help the browser decode). focal is the point the band
// zooms in on (CSS transform-origin), zoom how far: this aerial needs both
// to fill the band with fairways instead of the warehouses around it. A
// ground-level photo would likely use zoom 1 and a lower focal point.
export interface WelcomePhoto {
  src: string;
  width: number;
  height: number;
  focal: string;
  zoom: number;
  credit: string;
}

// A golf course on the Jersey City waterfront (Liberty National area), from
// USGS NAIP orthoimagery at its native ~0.6 m per pixel (public domain;
// exported 2026-11-09 from imagery.nationalmap.gov). The old welcome photo
// was a 1280x720 aerial zoomed 2x, which looked soft on a desktop half
// screen (Micky, 2026-11-09); this is a 1200x1600 crop of the fairways
// themselves, so it needs no zoom and stays sharp at about 2x on a phone
// band and on a Mac's half-screen sign-in panel.
export const WELCOME_PHOTO: WelcomePhoto = {
  src: "/courses/welcome-aerial.jpg",
  width: 1200,
  height: 1600,
  focal: "50% 50%",
  zoom: 1,
  credit: "Aerial: USGS NAIP (public domain)",
};
