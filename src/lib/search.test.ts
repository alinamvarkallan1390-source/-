import { describe, expect, it } from "vitest";
import { hasSearchTerm, normalizePersianSearch } from "./search";

describe("Persian search normalization", () => {
  it("normalizes Arabic Yeh and Kaf to their Persian forms", () => {
    expect(normalizePersianSearch("يكى كتاب")).toBe("یکی کتاب");
    expect(normalizePersianSearch("كیف پول")).toBe("کیف پول");
  });

  it("normalizes half-spaces, diacritics, punctuation, and Arabic/Persian digits", () => {
    expect(normalizePersianSearch("جُست‌وجو، پیام ۱۲۳ و ٤٥٦!"))
      .toBe("جست وجو پیام 123 و 456");
  });

  it("compares multiword phrases against canonicalized text", () => {
    expect(hasSearchTerm("در گروه: جست‌وجوی پیام‌های فارسی", "جست وجوی پیام های فارسی")).toBe(true);
    expect(hasSearchTerm("سلام دنیا", "   ")).toBe(false);
  });
});
