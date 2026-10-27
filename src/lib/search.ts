const digitMap: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Canonical form shared by search input validation, highlights, and result matching. */
export function normalizePersianSearch(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[يى]/gu, "ی")
    .replace(/ك/gu, "ک")
    .replace(/[\u064B-\u065F\u0670]/gu, "")
    .replace(/ـ/gu, "")
    .replace(/[\u200c\u200d]/gu, " ")
    .replace(/[٠-٩۰-۹]/gu, (digit) => digitMap[digit] ?? digit)
    .toLocaleLowerCase("fa")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/[\u200e\u200f\u202a-\u202e]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function hasSearchTerm(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizePersianSearch(needle);
  if (!normalizedNeedle) return false;
  return normalizePersianSearch(haystack).includes(normalizedNeedle);
}
