import { LEAGUES, safeArticle, matchLabel, matchDate, toMatchCenter, entityError } from "./entitySearchUtils";

test("rejects executable and lookalike article links", () => {
  expect(safeArticle("javascript:alert(1)")).toBeNull();
  expect(safeArticle("https://fr.wikipedia.org.evil.test/wiki/X")).toBeNull();
  expect(safeArticle("https://fr.wikipedia.org/wiki/X")).toBe("https://fr.wikipedia.org/wiki/X");
});
test("distinguishes a scheduled match, a draw and missing scores", () => {
  expect(matchLabel({ state: "pre", home: { score: 0 }, away: { score: 0 } })).toBe("À venir");
  expect(matchLabel({ state: "post", home: { score: 0 }, away: { score: 0 } })).toBe("0 – 0");
  expect(matchLabel({ state: "post", home: {}, away: {} })).toBe("Score indisponible");
});
test("handles unknown dates and preserves match identity", () => {
  expect(matchDate("bad")).toBe("Horaire à confirmer");
  expect(toMatchCenter({ id: "123", home: { name: "A" }, away: { name: "B" } }, { league: "fra.1" }).league_slug).toBe("fra.1");
});
test("reports rate limits and supported competitions", () => {
  expect(entityError({ response: { status: 429 } })).toMatch(/minute/);
  expect(LEAGUES).toHaveLength(6);
});
