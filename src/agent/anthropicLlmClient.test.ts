import { describe, it, expect } from "vitest";
import { withCacheBreakpoint } from "./anthropicLlmClient";
import type { LlmMessage } from "../sessions/sessionStore";

const user = (t: string): LlmMessage => ({ role: "user", content: [{ type: "text", text: t }] });
const asst = (t: string): LlmMessage => ({ role: "assistant", content: [{ type: "text", text: t }] });

describe("withCacheBreakpoint", () => {
  it("marks only the last block and does not mutate the stored history", () => {
    const h = [user("a"), asst("b")];
    const out = withCacheBreakpoint(h) as any[];
    expect(out[1].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect((h[1].content as any[])[0].cache_control).toBeUndefined();
    expect(out[0].content[0].cache_control).toBeUndefined();
  });
});
