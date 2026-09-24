import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import { isAllowedHost, isBlockedAddress } from "./address-policy.js";

/** A failure the client caused (bad/disallowed URL, not a PDF) — the route turns these into a 4xx rather than a 500. */
export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export interface SafeFetchOptions {
  allowedHosts: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  /** Injectable for tests; defaults to node:dns lookup. */
  resolve?: typeof dnsLookup;
}

/**
 * Checks everything about a URL that can be checked before connecting.
 * Applied to the first URL and to every redirect target, since an
 * allowlisted host redirecting to an internal one is the classic bypass.
 */
export function assertUrlAllowed(url: URL, allowedHosts: readonly string[]): void {
  if (url.protocol !== "https:") throw new ImportError("Only https:// URLs can be imported");
  if (url.username || url.password) throw new ImportError("URLs with credentials are not allowed");
  if (url.port && url.port !== "443") throw new ImportError("Only the default https port is allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!isAllowedHost(host, allowedHosts)) {
    throw new ImportError(`Host ${host} is not on the import allowlist`);
  }
  // Node skips DNS lookup for IP literals, so the lookup guard below never
  // sees them — check here instead.
  if (isIP(host) && isBlockedAddress(host)) throw new ImportError("That address is not allowed");
}

/**
 * DNS lookup that refuses to hand the socket any blocked address. Doing the
 * check inside the connection's own lookup (rather than resolving once up
 * front, then connecting by name) means the address that was checked is
 * the one that gets connected to — no DNS-rebinding window between the two.
 * If *any* resolved address is blocked the whole host is refused.
 */
function guardedLookup(resolve: typeof dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, "", 0);
        return;
      }
      const list = addresses as unknown as LookupAddress[];
      if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
        callback(new ImportError(`${hostname} resolves to a disallowed address`), "", 0);
        return;
      }
      if (options.all) {
        (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      } else {
        callback(null, list[0].address, list[0].family);
      }
    });
  };
}

function request(url: URL, options: SafeFetchOptions): Promise<IncomingMessage> {
  return new Promise((resolvePromise, reject) => {
    const req = https.get(
      url,
      {
        lookup: guardedLookup(options.resolve ?? dnsLookup),
        // No proxy/agent reuse: every connection goes through the guarded lookup.
        agent: false,
        timeout: options.timeoutMs,
        headers: { "User-Agent": "paper-xray-importer/1.0", Accept: "application/pdf" },
      },
      resolvePromise,
    );
    req.on("timeout", () => req.destroy(new ImportError("Timed out fetching the URL", 504)));
    req.on("error", reject);
  });
}

function readBody(res: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      reject(new ImportError(`PDF is larger than ${maxBytes} bytes`, 413));
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const timer = setTimeout(() => res.destroy(new ImportError("Timed out downloading the PDF", 504)), timeoutMs);
    res.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        res.destroy(new ImportError(`PDF is larger than ${maxBytes} bytes`, 413));
        return;
      }
      chunks.push(chunk);
    });
    res.on("end", () => {
      clearTimeout(timer);
      resolvePromise(Buffer.concat(chunks));
    });
    res.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Fetches a PDF from a user-supplied URL under the SSRF policy in
 * docs/02-decisions.md #7: https only, host allowlist, blocked address
 * ranges enforced at connect time, redirects followed manually (each hop
 * re-validated), size and time capped, and the body must be a PDF.
 */
export async function fetchPdf(startUrl: URL, options: SafeFetchOptions): Promise<Buffer> {
  const maxRedirects = options.maxRedirects ?? 5;
  let url = startUrl;

  for (let hop = 0; ; hop++) {
    assertUrlAllowed(url, options.allowedHosts);
    let res: IncomingMessage;
    try {
      res = await request(url, options);
    } catch (err) {
      if (err instanceof ImportError) throw err;
      throw new ImportError(`Could not fetch ${url.hostname}: ${(err as Error).message}`, 502);
    }

    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hop >= maxRedirects) throw new ImportError("Too many redirects", 502);
      url = new URL(res.headers.location, url);
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw new ImportError(`Remote server responded ${status}`, 502);
    }

    const body = await readBody(res, options.maxBytes, options.timeoutMs);
    if (body.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new ImportError("The URL did not return a PDF");
    }
    return body;
  }
}
