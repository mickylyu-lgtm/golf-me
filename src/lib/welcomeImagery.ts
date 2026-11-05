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

// Skyway Golf Course, Jersey City: USGS NAIP orthoimagery, public domain
// (also the Skyway course page's hero, services/teeTimes/types.ts).
export const WELCOME_PHOTO: WelcomePhoto = {
  src: "/courses/skyway-aerial.jpg",
  width: 1280,
  height: 720,
  focal: "47% 55%",
  zoom: 2,
  credit: "Aerial: USGS NAIP (public domain)",
};
