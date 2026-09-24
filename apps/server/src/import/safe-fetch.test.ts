import type { lookup } from "node:dns";
import { describe, expect, it } from "vitest";
import { isAllowedHost, isBlockedAddress } from "./address-policy.js";
import { assertUrlAllowed, fetchPdf, ImportError } from "./safe-fetch.js";

const ALLOWED = ["arxiv.org", "example.org"];

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2002:a00:1::",
    "not-an-ip",
  ])("blocks %s", (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  it.each(["151.101.1.1", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (addr) => {
    expect(isBlockedAddress(addr)).toBe(false);
  });
});

describe("isAllowedHost", () => {
  it("matches exact hosts and subdomains only", () => {
    expect(isAllowedHost("arxiv.org", ALLOWED)).toBe(true);
    expect(isAllowedHost("export.arxiv.org", ALLOWED)).toBe(true);
    expect(isAllowedHost("ARXIV.ORG.", ALLOWED)).toBe(true);
    expect(isAllowedHost("evilarxiv.org", ALLOWED)).toBe(false);
    expect(isAllowedHost("arxiv.org.evil.com", ALLOWED)).toBe(false);
  });
});

describe("assertUrlAllowed", () => {
  it("accepts an allowlisted https URL", () => {
    expect(() => assertUrlAllowed(new URL("https://arxiv.org/pdf/1"), ALLOWED)).not.toThrow();
  });

  it.each([
    ["http://arxiv.org/pdf/1", /https/],
    ["https://evil.com/x.pdf", /allowlist/],
    ["https://arxiv.org:8443/pdf/1", /port/],
    ["https://user:pw@arxiv.org/pdf/1", /credentials/],
    ["https://127.0.0.1/x.pdf", /allowlist/],
    ["file:///etc/passwd", /https/],
  ])("rejects %s", (url, message) => {
    expect(() => assertUrlAllowed(new URL(url), ALLOWED)).toThrow(message);
  });

  it("rejects a blocked IP literal even if an admin allowlisted it", () => {
    expect(() => assertUrlAllowed(new URL("https://10.0.0.5/x.pdf"), ["10.0.0.5"])).toThrow(/not allowed/);
  });
});

function fakeResolve(addresses: Array<{ address: string; family: number }>): typeof lookup {
  return ((_host: string, _opts: unknown, cb: (err: null, a: typeof addresses) => void) => {
    cb(null, addresses);
  }) as unknown as typeof lookup;
}

describe("fetchPdf", () => {
  const base = { allowedHosts: ALLOWED, maxBytes: 1024, timeoutMs: 2000 };

  it("refuses to connect when an allowlisted name resolves to a private address (DNS rebinding)", async () => {
    const err = await fetchPdf(new URL("https://example.org/paper.pdf"), {
      ...base,
      resolve: fakeResolve([{ address: "127.0.0.1", family: 4 }]),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect((err as Error).message).toMatch(/disallowed address/);
  });

  it("refuses when any one of several resolved addresses is private", async () => {
    const err = await fetchPdf(new URL("https://example.org/paper.pdf"), {
      ...base,
      resolve: fakeResolve([
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]),
    }).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/disallowed address/);
  });

  it("refuses a non-allowlisted host without resolving it", async () => {
    let resolved = false;
    const resolve = ((_h: string, _o: unknown, cb: (e: null, a: unknown[]) => void) => {
      resolved = true;
      cb(null, []);
    }) as unknown as typeof lookup;
    await expect(fetchPdf(new URL("https://internal.corp/x.pdf"), { ...base, resolve })).rejects.toThrow(/allowlist/);
    expect(resolved).toBe(false);
  });
});
