export function normalizeResumePdfText(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2015\u2212]/g, "-")
    .replace(/[\u2190-\u21FF]/g, "->")
    .replace(/[\uFE00-\uFE0F\u{1F300}-\u{1FAFF}]/gu, "");
}
