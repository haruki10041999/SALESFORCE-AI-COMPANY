/**
 * Resource Gap Detector
 * 
 * リソース不足を検知し、イベントを発火する
 */

export interface GapDetectionResult {
  detected: boolean;
  resourceType: "skills" | "tools" | "presets";
  topic: string;
  topScore: number;
  threshold: number;
  gapSeverity: "none" | "low" | "medium" | "high";
  gapTrend?: "improving" | "stable" | "worsening" | "unknown";
  timestamp: string;
}

export interface GapEvent {
  event: "resource_gap_detected";
  payload: {
    resourceType: "skills" | "tools" | "presets";
    topic: string;
    topScore: number;
    threshold: number;
    gapSeverity: "low" | "medium" | "high";
    gapTrend?: "improving" | "stable" | "worsening" | "unknown";
  };
}

function calculateGapTrend(historyTopScores: number[]): "improving" | "stable" | "worsening" | "unknown" {
  if (historyTopScores.length < 2) {
    return "unknown";
  }
  const first = historyTopScores[0];
  const last = historyTopScores[historyTopScores.length - 1];
  const delta = last - first;
  if (delta >= 0.5) return "improving";
  if (delta <= -0.5) return "worsening";
  return "stable";
}

/**
 * ギャップ重大度を判定
 */
function calculateGapSeverity(
  topScore: number,
  threshold: number
): "none" | "low" | "medium" | "high" {
  if (topScore >= threshold) {
    return "none";
  }
  
  const ratio = topScore / threshold;
  if (ratio >= 0.75) {
    return "low"; // 75-100% のリソース利用可能
  } else if (ratio >= 0.5) {
    return "medium"; // 50-75% のリソース利用可能
  } else {
    return "high"; // 50% 未満のリソース利用可能
  }
}

/**
 * リソース不足を検知
 */
export function detectGap(
  resourceType: "skills" | "tools" | "presets",
  topic: string,
  topScore: number,
  threshold: number = 5,
  historyTopScores: number[] = []
): GapDetectionResult {
  const detected = topScore < threshold;
  const gapSeverity = calculateGapSeverity(topScore, threshold);
  const gapTrend = calculateGapTrend(historyTopScores);

  return {
    detected,
    resourceType,
    topic,
    topScore,
    threshold,
    gapSeverity: detected ? (gapSeverity as "low" | "medium" | "high") : "none",
    gapTrend,
    timestamp: new Date().toISOString()
  };
}

/**
 * ギャップイベントを生成
 */
export function createGapEvent(result: GapDetectionResult): GapEvent | null {
  if (!result.detected || result.gapSeverity === "none") {
    return null;
  }

  return {
    event: "resource_gap_detected",
    payload: {
      resourceType: result.resourceType,
      topic: result.topic,
      topScore: result.topScore,
      threshold: result.threshold,
      gapSeverity: result.gapSeverity,
      gapTrend: result.gapTrend
    }
  };
}

/**
 * 複数リソースタイプのギャップを検知
 */
export function detectGapsForTopic(
  topic: string,
  scores: {
    skills: number;
    tools: number;
    presets: number;
  },
  threshold: number = 5
): {
  results: GapDetectionResult[];
  events: GapEvent[];
} {
  const results: GapDetectionResult[] = [];
  const events: GapEvent[] = [];

  for (const resourceType of ["skills", "tools", "presets"] as const) {
    const topScore = scores[resourceType];
    const result = detectGap(resourceType, topic, topScore, threshold);
    results.push(result);

    const event = createGapEvent(result);
    if (event) {
      events.push(event);
    }
  }

  return { results, events };
}
