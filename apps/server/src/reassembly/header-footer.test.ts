import { beforeEach, describe, expect, it } from "vitest";
import { stripHeaderFooter } from "./header-footer.js";
import { lineText } from "./lines.js";
import { makeLine, resetItemIndex } from "./test-utils.js";

beforeEach(resetItemIndex);

describe("stripHeaderFooter", () => {
  it("removes a line that repeats at the same y across most pages", () => {
    const pages = [1, 2, 3, 4].map((page) => [
      makeLine(page, 750, 50, 200, 10, "Paper X-Ray"), // running header
      makeLine(page, 600, 50, 400, 10, `body text on page ${page}`),
    ]);

    const cleaned = stripHeaderFooter(pages);

    for (const page of cleaned) {
      expect(page.map(lineText)).not.toContain("Paper X-Ray");
      expect(page).toHaveLength(1);
    }
  });

  it("keeps a phrase that only happens to repeat on a couple of pages", () => {
    const pages = [1, 2, 3, 4].map((page) => [makeLine(page, 600, 50, 400, 10, `body text on page ${page}`)]);
    pages[0].push(makeLine(1, 500, 50, 200, 10, "see also section 2"));
    pages[1].push(makeLine(2, 500, 50, 200, 10, "see also section 2"));
    // repeats on only 2/4 pages, below the 60% threshold

    const cleaned = stripHeaderFooter(pages);
    expect(cleaned[0].map(lineText)).toContain("see also section 2");
  });

  it("is a no-op below 3 pages (not enough evidence of a repeating pattern)", () => {
    const pages = [1, 2].map((page) => [makeLine(page, 750, 50, 200, 10, "Paper X-Ray")]);
    expect(stripHeaderFooter(pages)).toEqual(pages);
  });
});
