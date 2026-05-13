export type CritiqueNextAction = "accept" | "regenerate" | "proposal";

export interface CritiqueRecord {
  sessionId?: string;
  agentName?: string;
  topic?: string;
  initialScore: number;
  finalScore: number;
  aiQualityScore: number;
  qualityImprovement: number;
  nextAction: CritiqueNextAction;
  stoppedReason: string;
  recordedAt: string;
}

export interface Critic {
  critique(input: {
    response: string;
    topic?: string;
    agentName?: string;
    maxIterations?: number;
    targetScore?: number;
    minImprovement?: number;
    judge?: boolean;
    model?: string;
    refineModel?: string;
  }): Promise<CritiqueRecord & { finalText: string; iterations: number }>;
}