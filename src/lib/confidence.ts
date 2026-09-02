// Section 7 (confidence formula) + Section 8 (match decision policy).
// Pure, no DB — the weights and thresholds here are the one place that changes
// if the tiering policy ever needs tuning.

export function computeConfidence(
  referenceSimilarity: number,
  amountSimilarity: number,
  dateSimilarity: number,
): number {
  const value = referenceSimilarity * 0.5 + amountSimilarity * 0.3 + dateSimilarity * 0.2;
  return Math.round(value * 100) / 100;
}

export type MatchTier = "AUTO_MATCH" | "REVIEW" | "UNMATCHED";

// >=95 auto-match, 80-94 always needs human review, <80 unmatched.
// Development Rule 5: never auto-write MATCHED below 95.
export function decideTier(confidence: number): MatchTier {
  if (confidence >= 95) return "AUTO_MATCH";
  if (confidence >= 80) return "REVIEW";
  return "UNMATCHED";
}
