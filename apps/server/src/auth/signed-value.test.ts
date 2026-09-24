import { describe, expect, it } from "vitest";
import { sign, verify } from "./signed-value.js";

describe("sign/verify", () => {
  it("round-trips a payload signed with the same secret", () => {
    const token = sign("user-123", "secret-a");
    expect(verify(token, "secret-a")).toBe("user-123");
  });

  it("rejects a token signed with a different secret", () => {
    const token = sign("user-123", "secret-a");
    expect(verify(token, "secret-b")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = sign("user-123", "secret-a");
    const tampered = token.replace("user-123", "user-999");
    expect(verify(tampered, "secret-a")).toBeNull();
  });

  it("rejects undefined/empty input", () => {
    expect(verify(undefined, "secret-a")).toBeNull();
    expect(verify("", "secret-a")).toBeNull();
  });

  it("rejects a value with no separator", () => {
    expect(verify("not-a-signed-value", "secret-a")).toBeNull();
  });

  it("round-trips a payload containing '.' characters", () => {
    const token = sign("a.b.c:d", "secret-a");
    expect(verify(token, "secret-a")).toBe("a.b.c:d");
  });
});
