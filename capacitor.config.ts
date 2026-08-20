import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.golfme.app",
  appName: "GolfMe",
  webDir: "dist",
  // Loads the live site instead of the bundled dist/ snapshot, so every
  // Vercel deploy updates the TestFlight app instantly too -- no new Xcode
  // archive/upload needed for ordinary feature or bug-fix work, only for
  // genuinely native changes (permissions, icon, native plugins). GolfMe is
  // Supabase-backed and needs network for everything anyway, so there's no
  // meaningful offline mode being given up here.
  server: {
    url: "https://golfme.app",
  },
};

export default config;
