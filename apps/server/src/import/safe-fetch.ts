import https from "node:https";
import type { IncomingMessage } from "node:http";

/** A failure the client caused (bad URL, not a PDF) — the route turns these into a 4xx rather than a 500. */
export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
}

function request(url: URL, options: SafeFetchOptions): Promise<IncomingMessage> {
  return new Promise((resolvePromise, reject) => {
    const req = https.get(
      url,
      {
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
 * Fetches a PDF from a user-supplied URL. Follows redirects manually,
 * caps size and time, and validates the response is a PDF.
 */
export async function fetchPdf(startUrl: URL, options: SafeFetchOptions): Promise<Buffer> {
  const maxRedirects = options.maxRedirects ?? 5;
  let url = startUrl;

  for (let hop = 0; ; hop++) {
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
