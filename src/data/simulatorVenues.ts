// Official location pages checked 2026-11-19 and 2026-11-28; reference catalog, not booking inventory.
export type SimulatorCity = "nyc" | "hk";
export interface SimulatorVenue { id: string; name: string; area: string; address: string; url: string; city: SimulatorCity; timezone: string; maxGroupSize?: 2 | 6 }
const hkUrl = "https://www.golfzonhk.com/contact-us/";
export const simulatorVenues: SimulatorVenue[] = [
 {id:"flatiron",maxGroupSize:6,name:"Five Iron Golf",area:"Flatiron",address:"605 6th Ave, New York, NY 10011",url:"https://fiveirongolf.com/locations/nyc-flatiron",city:"nyc",timezone:"America/New_York"},
 {id:"herald",name:"Five Iron Golf",area:"Herald Square",address:"883 6th Ave, Floor 3, New York, NY 10001",url:"https://fiveirongolf.com/locations/nyc-herald-square",city:"nyc",timezone:"America/New_York"},
 {id:"five-iron-grand-central",name:"Five Iron Golf",area:"Grand Central",address:"101 Park Ave, Floor 3, New York, NY 10017",url:"https://fiveirongolf.com/locations/nyc-grand-central",city:"nyc",timezone:"America/New_York",maxGroupSize:6},
 {id:"five-iron-upper-east-side",name:"Five Iron Golf",area:"Upper East Side",address:"1681 3rd Ave, New York, NY 10128",url:"https://fiveirongolf.com/locations/nyc-upper-east-side",city:"nyc",timezone:"America/New_York",maxGroupSize:6},
 {id:"five-iron-long-island-city",name:"Five Iron Golf",area:"Long Island City",address:"22-43 Jackson Ave, Long Island City, NY 11101",url:"https://fiveirongolf.com/locations/nyc-long-island-city",city:"nyc",timezone:"America/New_York",maxGroupSize:6},
 {id:"golfzon-social-brooklyn",name:"GOLFZON Social",area:"Downtown Brooklyn",address:"15 Hoyt St, Brooklyn, NY 11201",url:"https://golfzonsocial.com/locations/brooklyn/",city:"nyc",timezone:"America/New_York",maxGroupSize:6},
 {id:"x-golf-brooklyn",name:"X-Golf",area:"Williamsburg",address:"105 N 13th St, Brooklyn, NY 11249",url:"https://playxgolf.com/locations/brooklyn/",city:"nyc",timezone:"America/New_York",maxGroupSize:6},
 {id:"bklyn-swing",name:"BKLYN SWING",area:"Dyker Heights",address:"7613 13th Ave, Brooklyn, NY 11228",url:"https://bklynswing.com/faq/",city:"nyc",timezone:"America/New_York",maxGroupSize:2},
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
