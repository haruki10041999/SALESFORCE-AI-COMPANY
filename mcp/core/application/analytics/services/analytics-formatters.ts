export type StarRating = "thumbs-up" | "thumbs-down" | "neutral";

export function starToRating(stars: number): StarRating {
  if (stars >= 4) return "thumbs-up";
  if (stars <= 2) return "thumbs-down";
  return "neutral";
}

export function duplicateEntries(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return [...duplicates].sort();
}

export function escapeMermaidId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "node";
}

export function trimForNodeLabel(value: string, max = 48): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
}
