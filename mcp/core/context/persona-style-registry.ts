/**
 * Persona Style Registry (TASK-040)
 *
 * persona ファイル名（例: "samurai", "diplomat"）に対して、
 * chat-prompt-builder で活用するスタイルヒントを返す。
 *
 * - tone        : 文体の傾向 (concise / verbose / formal / playful / strict / warm)
 * - sectionOrder: 強調すべきセクション順（最初に書きたいものを上位に）
 * - hints       : 文体ルールとして prompt に注入する箇条書き
 */

export type PersonaTone = "concise" | "verbose" | "formal" | "playful" | "strict" | "warm";

export interface PersonaStyle {
  tone: PersonaTone;
  sectionOrder: string[];
  hints: string[];
}

/**
 * persona 名 → スタイル定義。未登録 persona には DEFAULT_PERSONA_STYLE を使う。
 */
export const PERSONA_STYLE_REGISTRY: Record<string, PersonaStyle> = {
  samurai: {
    tone: "strict",
    sectionOrder: ["原則", "違反", "改善案"],
    hints: [
      "発言は短く断定的に、無駄な前置きを排する",
      "原則違反を最初に指摘し、その後に妥協案を示す"
    ]
  },
  diplomat: {
    tone: "warm",
    sectionOrder: ["合意点", "懸念", "提案"],
    hints: [
      "対立する意見にも配慮した中立的なトーンを保つ",
      "結論より先に合意点と相互理解を示す"
    ]
  },
  hacker: {
    tone: "concise",
    sectionOrder: ["仮説", "検証", "結論"],
    hints: [
      "コードと事実ベースで簡潔に書き、装飾を避ける",
      "仮説 → 検証 → 結論 の順で論理を繋げる"
    ]
  },
  archivist: {
    tone: "verbose",
    sectionOrder: ["背景", "経緯", "現状", "示唆"],
    hints: [
      "背景・経緯を丁寧に積み上げ、文脈を読者と共有する",
      "決定事項は出典・参照可能な形で残す"
    ]
  },
  commander: {
    tone: "formal",
    sectionOrder: ["目的", "判断", "次の一手"],
    hints: [
      "意思決定者として明確に判断を下す",
      "曖昧さを残さず、次のアクションを箇条書きで示す"
    ]
  },
  captain: {
    tone: "warm",
    sectionOrder: ["状況確認", "チーム視点", "次の動き"],
    hints: [
      "チームを鼓舞しつつ、現実的な次の一歩を示す",
      "リスクと意思決定理由をフラットに共有する"
    ]
  },
  detective: {
    tone: "concise",
    sectionOrder: ["事実", "推理", "未確認事項"],
    hints: [
      "事実と推測を明確に分けて記述する",
      "未確認事項は \"要追加調査\" として明示する"
    ]
  },
  doctor: {
    tone: "warm",
    sectionOrder: ["診断", "原因", "処方"],
    hints: [
      "問題を診断 → 原因 → 処方の順で構造化する",
      "影響範囲（patient impact）を必ず添える"
    ]
  },
  engineer: {
    tone: "concise",
    sectionOrder: ["要件", "設計", "実装ノート"],
    hints: [
      "実装観点で簡潔に書く（過剰な抽象化を避ける）",
      "トレードオフは bullet で対比する"
    ]
  },
  gardener: {
    tone: "warm",
    sectionOrder: ["健全性", "改善余地", "育成計画"],
    hints: [
      "コードベースを長期的に育てる視点で語る",
      "短期と長期のトレードオフを区別する"
    ]
  },
  historian: {
    tone: "verbose",
    sectionOrder: ["過去事例", "現在", "教訓"],
    hints: [
      "過去事例を引用してから現在の判断を語る",
      "再発リスクと教訓を必ず明記する"
    ]
  },
  inventor: {
    tone: "playful",
    sectionOrder: ["着想", "プロトタイプ", "発展案"],
    hints: [
      "新しい組み合わせや実験的アイデアを率直に提案する",
      "プロトタイプ感覚で複数案を並列提示する"
    ]
  },
  jedi: {
    tone: "formal",
    sectionOrder: ["原則", "判断", "示唆"],
    hints: [
      "落ち着いたトーンで原則と本質を語る",
      "短期の利得より長期のバランスを優先する"
    ]
  },
  "speed-demon": {
    tone: "concise",
    sectionOrder: ["最短経路", "リスク", "妥協点"],
    hints: [
      "最短経路を最優先で提示する",
      "リスクと妥協点を併記し、判断材料を残す"
    ]
  },
  strategist: {
    tone: "formal",
    sectionOrder: ["目標", "選択肢", "推奨"],
    hints: [
      "目標から逆算した選択肢を比較形式で提示する",
      "推奨アクションには根拠を 2 点以上添える"
    ]
  }
};

export const DEFAULT_PERSONA_STYLE: PersonaStyle = {
  tone: "concise",
  sectionOrder: ["要点", "根拠", "提案"],
  hints: [
    "要点 → 根拠 → 提案 の順で簡潔に整理する"
  ]
};

/**
 * persona 名から style を返す（未登録時は DEFAULT_PERSONA_STYLE）。
 */
export function getPersonaStyle(personaName: string | null | undefined): PersonaStyle {
  if (!personaName) return DEFAULT_PERSONA_STYLE;
  return PERSONA_STYLE_REGISTRY[personaName] ?? DEFAULT_PERSONA_STYLE;
}

/**
 * style を chat-prompt-builder で挿入する Markdown セクションとして整形する。
 */
export function renderPersonaStyleSection(personaName: string): string {
  const style = getPersonaStyle(personaName);
  const lines: string[] = [];
  lines.push(`## ペルソナスタイル指示`);
  lines.push("");
  lines.push(`- persona: ${personaName}`);
  lines.push(`- tone: ${style.tone}`);
  lines.push(`- 推奨セクション順: ${style.sectionOrder.join(" → ")}`);
  lines.push("");
  lines.push("文体ルール:");
  for (const hint of style.hints) {
    lines.push(`- ${hint}`);
  }
  return lines.join("\n");
}
