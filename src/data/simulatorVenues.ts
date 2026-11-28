// Official location pages checked 2026-11-19; reference catalog, not booking inventory.
export type SimulatorCity = "nyc" | "hk";
export interface SimulatorVenue { id: string; name: string; area: string; address: string; url: string; city: SimulatorCity; timezone: string; maxGroupSize?: 6 }
const hkUrl = "https://www.golfzonhk.com/contact-us/";
export const simulatorVenues: SimulatorVenue[] = [
 {id:"flatiron",maxGroupSize:6,name:"Five Iron Golf",area:"Flatiron",address:"605 6th Ave, New York, NY 10011",url:"https://fiveirongolf.com/locations/nyc-flatiron",city:"nyc",timezone:"America/New_York"},
 {id:"herald",name:"Five Iron Golf",area:"Herald Square",address:"883 6th Ave, Floor 3, New York, NY 10001",url:"https://fiveirongolf.com/locations/nyc-herald-square",city:"nyc",timezone:"America/New_York"},
 {id:"golfzon-admiralty",name:"GOLFZON",area:"Admiralty",address:"Shop 70-79 & 91-97, 2/F, Admiralty Centre, 18 Harcourt Road, Admiralty, Hong Kong",url:hkUrl,city:"hk",timezone:"Asia/Hong_Kong"},
 {id:"golfzon-causeway",name:"GOLFZON",area:"Causeway Bay",address:"2/F, SCAA Sports Complex, 88 Caroline Hill Road, Hong Kong",url:hkUrl,city:"hk",timezone:"Asia/Hong_Kong"},
 {id:"golfzon-laichikok",name:"GOLFZON",area:"Lai Chi Kok",address:"Shop 114-127, 1/F, D2 Place ONE, 9 Cheung Yee St., Lai Chi Kok, Kowloon",url:hkUrl,city:"hk",timezone:"Asia/Hong_Kong"},
 {id:"golfzon-tste",name:"GOLFZON",area:"Tsim Sha Tsui East",address:"Shops 147-153, 155 & 156, 1/F, New Mandarin Plaza Shopping Centre, 14 Science Museum Road, Tsim Sha Tsui, Kowloon",url:hkUrl,city:"hk",timezone:"Asia/Hong_Kong"},
 {id:"golfzon-kowloonbay",name:"GOLFZON",area:"Kowloon Bay",address:"Shop 11, 1/F, 77 Hoi Bun Road, The Quayside, Kowloon East",url:hkUrl,city:"hk",timezone:"Asia/Hong_Kong"},
];
export function simulatorCityForLocation(label: string): SimulatorCity | undefined {
 const s=label.trim().toLowerCase();
 if (/(^|[,\s])(hong kong|kowloon|hk)(?=$|[,\s])/.test(s) || /香港|九龍|九龙/.test(s)) return "hk";
 if (/(^|[,\s])(new york city|new york|nyc|manhattan|brooklyn|queens|bronx|staten island)(?=$|[,\s])/.test(s)) return "nyc";
 return undefined;
}
export function simulatorVenuesForCity(city: SimulatorCity | undefined) { return simulatorVenues.filter(v=>v.city===city); }

// Unverified venues retain the conservative GolfMe group limit, not a claimed bay policy.
export function simulatorCapacities(venue: SimulatorVenue): number[] { return Array.from({length:(venue.maxGroupSize ?? 4)-1},(_,i)=>i+2); }
