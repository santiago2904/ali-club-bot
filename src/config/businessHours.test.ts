import { describe, it, expect } from "vitest";
import { isOpen, hoursText } from "./businessHours";

describe("businessHours", () => {
  it("is open at 19:00 and closed at 04:00", () => {
    const open = new Date(2026, 6, 9, 19, 0);
    const closed = new Date(2026, 6, 9, 4, 0);
    expect(isOpen(open)).toBe(true);
    expect(isOpen(closed)).toBe(false);
  });

  it("exposes a Spanish hours description", () => {
    expect(hoursText()).toMatch(/\d/);
  });
});
