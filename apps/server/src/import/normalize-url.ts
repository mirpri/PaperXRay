/**
 * Canonicalizes paper URLs before fetching (docs/02-decisions.md #7): the
 * same arXiv paper is reachable as /abs/, /pdf/, /pdf/<id>.pdf and /html/,
 * on arxiv.org, www.arxiv.org and export.arxiv.org. Fetching all of them
 * from one canonical PDF URL means they produce the same bytes and so
 * dedupe on contentHash instead of being stored twice.
 */

// New-style ids (2401.12345, 0704.0001) and old-style ones (hep-th/9901001, math.GT/0309136), optional version suffix.
const ARXIV_ID = /^((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(v\d+)?$/;
const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org", "export.arxiv.org"]);

export interface NormalizedPaperUrl {
  /** The URL that will actually be fetched. */
  fetchUrl: URL;
  /** Fallback display title when the PDF has no recognizable title. */
  suggestedFilename: string;
}

function arxivId(url: URL): string | null {
  if (!ARXIV_HOSTS.has(url.hostname)) return null;
  const match = /^\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/.exec(url.pathname);
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  return ARXIV_ID.test(id) ? id : null;
}

export function normalizePaperUrl(input: string): NormalizedPaperUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Not a valid URL");
  }

  const id = arxivId(url);
  if (id) {
    return {
      fetchUrl: new URL(`https://arxiv.org/pdf/${id}`),
      suggestedFilename: `arXiv-${id.replace("/", "_")}.pdf`,
    };
  }

  // OpenReview: the forum page and the PDF share an `id` query param.
  if (url.hostname === "openreview.net" && (url.pathname === "/forum" || url.pathname === "/pdf")) {
    const paperId = url.searchParams.get("id");
    if (paperId) {
      const fetchUrl = new URL("https://openreview.net/pdf");
      fetchUrl.searchParams.set("id", paperId);
      return { fetchUrl, suggestedFilename: `openreview-${paperId}.pdf` };
    }
  }

  url.hash = "";
  const lastSegment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  const base = lastSegment || url.hostname;
  return { fetchUrl: url, suggestedFilename: base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf` };
}
