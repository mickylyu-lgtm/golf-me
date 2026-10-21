import type { PlaceNameKey } from "../../supabase/functions/_shared/cityGeocode.ts";

// Names of the 12 built-in regions (src/data/regions.ts) in GolfMe's six
// languages, shipped in the bundle so they localize with no network and no
// Geoapify credits. Keyed like public.geo_places.names (zh-CN reads
// zh-Hans, zh-TW reads zh-Hant). regionCode is the state/province shown
// after the city in English/Spanish for US/Canada ("New York, NY").
export interface RegionNames {
  names: Record<PlaceNameKey, string>;
  regionCode?: string;
}

export const REGION_NAMES: Record<string, RegionNames> = {
  nyc: { regionCode: "NY", names: { en: "New York", es: "Nueva York", ja: "ニューヨーク", ko: "뉴욕", "zh-Hans": "纽约", "zh-Hant": "紐約" } },
  la: { regionCode: "CA", names: { en: "Los Angeles", es: "Los Ángeles", ja: "ロサンゼルス", ko: "로스앤젤레스", "zh-Hans": "洛杉矶", "zh-Hant": "洛杉磯" } },
  miami: { regionCode: "FL", names: { en: "Miami", es: "Miami", ja: "マイアミ", ko: "마이애미", "zh-Hans": "迈阿密", "zh-Hant": "邁阿密" } },
  chicago: { regionCode: "IL", names: { en: "Chicago", es: "Chicago", ja: "シカゴ", ko: "시카고", "zh-Hans": "芝加哥", "zh-Hant": "芝加哥" } },
  sf: { regionCode: "CA", names: { en: "San Francisco", es: "San Francisco", ja: "サンフランシスコ", ko: "샌프란시스코", "zh-Hans": "旧金山", "zh-Hant": "舊金山" } },
  austin: { regionCode: "TX", names: { en: "Austin", es: "Austin", ja: "オースティン", ko: "오스틴", "zh-Hans": "奥斯汀", "zh-Hant": "奧斯汀" } },
  boston: { regionCode: "MA", names: { en: "Boston", es: "Boston", ja: "ボストン", ko: "보스턴", "zh-Hans": "波士顿", "zh-Hant": "波士頓" } },
  toronto: { regionCode: "ON", names: { en: "Toronto", es: "Toronto", ja: "トロント", ko: "토론토", "zh-Hans": "多伦多", "zh-Hant": "多倫多" } },
  london: { names: { en: "London", es: "Londres", ja: "ロンドン", ko: "런던", "zh-Hans": "伦敦", "zh-Hant": "倫敦" } },
  hongkong: { names: { en: "Hong Kong", es: "Hong Kong", ja: "香港", ko: "홍콩", "zh-Hans": "香港", "zh-Hant": "香港" } },
  singapore: { names: { en: "Singapore", es: "Singapur", ja: "シンガポール", ko: "싱가포르", "zh-Hans": "新加坡", "zh-Hant": "新加坡" } },
  sydney: { names: { en: "Sydney", es: "Sídney", ja: "シドニー", ko: "시드니", "zh-Hans": "悉尼", "zh-Hant": "雪梨" } },
};
