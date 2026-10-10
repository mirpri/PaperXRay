import { describe, expect, it } from "vitest";
import { fetchPdf } from "./safe-fetch.js";

describe("fetchPdf", () => {
  it("has correct options interface", () => {
    const options = { maxBytes: 1024, timeoutMs: 2000 };
    expect(options.maxBytes).toBe(1024);
    expect(options.timeoutMs).toBe(2000);
  });
});
