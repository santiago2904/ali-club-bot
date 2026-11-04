import { describe, it, expect } from "vitest";
import { haversineKm, quoteDelivery, STORE_LOCATION } from "./delivery";

describe("delivery", () => {
  it("haversineKm is ~1.11 km per 0.01° of latitude", () => {
    const km = haversineKm({ lat: 6.25, lng: -75.6 }, { lat: 6.26, lng: -75.6 });
    expect(km).toBeCloseTo(1.11, 1);
  });

  it("quotes the first band for a nearby address", () => {
    const q = quoteDelivery({ lat: STORE_LOCATION.lat + 0.005, lng: STORE_LOCATION.lng });
    expect(q).toEqual({ covered: true, km: 0.8, feeCop: 3000 });
  });

  it("applies the road factor before picking a band", () => {
    // ~2.2 km straight line → ~3.1 km by road → second band
    const q = quoteDelivery({ lat: STORE_LOCATION.lat + 0.02, lng: STORE_LOCATION.lng });
    expect(q).toMatchObject({ covered: true, feeCop: 5000 });
  });

  it("rejects addresses beyond the last band", () => {
    // ~El Poblado, far from San Javier
    const q = quoteDelivery({ lat: 6.2087, lng: -75.5674 });
    expect(q.covered).toBe(false);
  });
});
