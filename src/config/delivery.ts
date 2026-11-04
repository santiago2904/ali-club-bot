// Store pin: ALI CLUB, San Javier, Medellín (from Google Maps).
export const STORE_LOCATION = { lat: 6.2514348, lng: -75.621668 };

// Straight-line distance underestimates real routes (hills, one-ways); scale it up.
const ROAD_FACTOR = 1.4;

// Bands fitted to fees observed in the business's chats (Comuna 13: $4.000–$10.000;
// Laureles out of coverage). Distances are road-adjusted. Hills still cost more than
// distance suggests; staff reviews every order before approving.
const FEE_BANDS: { maxKm: number; feeCop: number }[] = [
  { maxKm: 1.5, feeCop: 4000 },
  { maxKm: 2.5, feeCop: 6000 },
  { maxKm: 3.5, feeCop: 7000 },
  { maxKm: 4.5, feeCop: 9000 },
  { maxKm: 5, feeCop: 10000 },
];

export type DeliveryQuote =
  | { covered: true; km: number; feeCop: number }
  | { covered: false; km: number };

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function quoteDelivery(to: { lat: number; lng: number }): DeliveryQuote {
  const km = Math.round(haversineKm(STORE_LOCATION, to) * ROAD_FACTOR * 10) / 10;
  const band = FEE_BANDS.find((b) => km <= b.maxKm);
  return band ? { covered: true, km, feeCop: band.feeCop } : { covered: false, km };
}
