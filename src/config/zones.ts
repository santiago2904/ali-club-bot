export interface ZoneResult {
  covered: boolean;
  deliveryFeeCop: number;
  neighborhood: string;
}

interface ZoneEntry {
  key: string; // normalized
  deliveryFeeCop: number;
}

// Placeholder coverage — confirm real neighborhoods/fees with the business.
const ZONES: ZoneEntry[] = [
  { key: "laureles", deliveryFeeCop: 5000 },
  { key: "belen", deliveryFeeCop: 6000 },
  { key: "estadio", deliveryFeeCop: 5000 },
  { key: "poblado", deliveryFeeCop: 8000 },
];

export function normalizeNeighborhood(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function validateZone(neighborhood: string): ZoneResult {
  const key = normalizeNeighborhood(neighborhood);
  const match = ZONES.find((z) => z.key === key);
  return {
    covered: Boolean(match),
    deliveryFeeCop: match?.deliveryFeeCop ?? 0,
    neighborhood: key,
  };
}
