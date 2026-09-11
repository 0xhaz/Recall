/**
 * Reciprocal rank fusion: combine several ranked id lists (e.g. keyword and vector search)
 * into one score per id. k damps the weight of top ranks; 60 is the usual choice.
 */
export function reciprocalRankFusion(rankings: readonly (readonly string[])[], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return scores;
}
