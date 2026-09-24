import { describe, expect, it } from "vitest";
import { normalizePaperUrl } from "./normalize-url.js";

describe("normalizePaperUrl", () => {
  it.each([
    "https://arxiv.org/abs/2401.12345",
    "https://arxiv.org/pdf/2401.12345",
    "https://arxiv.org/pdf/2401.12345.pdf",
    "http://www.arxiv.org/abs/2401.12345/",
    "https://export.arxiv.org/abs/2401.12345",
    "https://arxiv.org/html/2401.12345",
  ])("maps %s to the canonical arXiv PDF URL", (input) => {
    expect(normalizePaperUrl(input).fetchUrl.href).toBe("https://arxiv.org/pdf/2401.12345");
  });

  it("keeps an explicit version", () => {
    const n = normalizePaperUrl("https://arxiv.org/abs/2401.12345v3");
    expect(n.fetchUrl.href).toBe("https://arxiv.org/pdf/2401.12345v3");
    expect(n.suggestedFilename).toBe("arXiv-2401.12345v3.pdf");
  });

  it("handles old-style arXiv ids", () => {
    expect(normalizePaperUrl("https://arxiv.org/abs/hep-th/9901001v2").fetchUrl.href).toBe(
      "https://arxiv.org/pdf/hep-th/9901001v2",
    );
    expect(normalizePaperUrl("https://arxiv.org/abs/math.GT/0309136").fetchUrl.href).toBe(
      "https://arxiv.org/pdf/math.GT/0309136",
    );
  });

  it("maps an OpenReview forum page to its PDF", () => {
    expect(normalizePaperUrl("https://openreview.net/forum?id=abcXYZ&noteId=1").fetchUrl.href).toBe(
      "https://openreview.net/pdf?id=abcXYZ",
    );
  });

  it("passes other URLs through, minus the fragment", () => {
    const n = normalizePaperUrl("https://aclanthology.org/2023.acl-long.1.pdf#page=2");
    expect(n.fetchUrl.href).toBe("https://aclanthology.org/2023.acl-long.1.pdf");
    expect(n.suggestedFilename).toBe("2023.acl-long.1.pdf");
  });

  it("rejects garbage", () => {
    expect(() => normalizePaperUrl("not a url")).toThrow();
  });
});
