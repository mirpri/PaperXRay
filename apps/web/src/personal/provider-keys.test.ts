import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProviderKey, saveProviderKey } from "./provider-keys";
const data = new Map<string, string>();
beforeEach(() => {
  data.clear(); vi.stubGlobal("window", { localStorage: { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) } });
});
afterEach(() => vi.unstubAllGlobals());
describe("personal provider keys", () => {
  it("isolates keys by both user and provider", () => {
    saveProviderKey("alice", "provider-one", "alice-key");
    saveProviderKey("bob", "provider-one", "bob-key");
    expect(loadProviderKey("alice", "provider-one")).toBe("alice-key");
    expect(loadProviderKey("bob", "provider-one")).toBe("bob-key");
    expect(loadProviderKey("alice", "provider-two")).toBe("");
    saveProviderKey("alice", "provider-one", "");
    expect(loadProviderKey("alice", "provider-one")).toBe("");
    expect(loadProviderKey("bob", "provider-one")).toBe("bob-key");
  });
});
