import { describe, it, expect, afterEach } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { LocalProofStorage } from "./localProofStorage";

const dir = "./data/test-proofs";

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalProofStorage", () => {
  it("writes bytes to a file and returns its path", async () => {
    const storage = new LocalProofStorage(dir);
    const path = await storage.save("42", Buffer.from("hello"), "jpg");
    expect(path).toContain("42");
    expect(path.endsWith(".jpg")).toBe(true);
    expect((await readFile(path)).toString()).toBe("hello");
  });
});
