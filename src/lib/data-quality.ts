/**
 * 학습 데이터 품질 필터링
 * 저질 데이터는 저장하지 않음
 */

export type DataQualityCheckResult = {
  isValid: boolean;
  reasons: string[];
  score: number; // 0~100
};

export function checkTranslationQuality(
  sourceText: string,
  translatedText: string,
  confidence: number
): DataQualityCheckResult {
  const reasons: string[] = [];
  let score = 100;

  // 1. OCR 신뢰도 체크 (< 0.6은 저질)
  if (confidence < 0.6) {
    reasons.push(`OCR 신뢰도 낮음: ${(confidence * 100).toFixed(0)}%`);
    score -= 40;
  } else if (confidence < 0.8) {
    reasons.push(`OCR 신뢰도 중간: ${(confidence * 100).toFixed(0)}%`);
    score -= 15;
  }

  // 2. 텍스트 길이 체크
  const sourceLen = sourceText.trim().length;
  const translatedLen = translatedText.trim().length;

  if (sourceLen < 2) {
    reasons.push("원문이 너무 짧음");
    score -= 30;
  }

  if (translatedLen < 2) {
    reasons.push("번역문이 너무 짧음");
    score -= 30;
  }

  // 3. 번역 결과가 원문과 동일한지 체크
  if (sourceText.trim() === translatedText.trim()) {
    reasons.push("번역되지 않음 (원문과 동일)");
    score -= 50;
  }

  // 4. 빈 번역문 체크
  if (!translatedText || !translatedText.trim()) {
    reasons.push("번역문이 비어있음");
    score -= 50;
  }

  // 5. 유사도 체크 (번역이 너무 원문과 비슷하면 제외)
  const similarity = calculateSimilarity(sourceText, translatedText);
  if (similarity > 0.8) {
    reasons.push("번역과 원문의 유사도가 높음 (번역이 부정확할 가능성)");
    score -= 25;
  }

  // 6. 숫자만 있는 텍스트 제외
  if (/^\d+$/.test(sourceText.trim())) {
    reasons.push("숫자만으로 구성됨");
    score -= 40;
  }

  // 7. 기호만 있는 텍스트 제외
  if (!/[가-힣ぁ-ゟァ-ヴーｱ-ﾝa-zA-Z]/.test(sourceText)) {
    reasons.push("의미 있는 문자 없음 (기호만 있음)");
    score -= 40;
  }

  const isValid = score >= 60; // 60점 이상만 유효

  return {
    isValid,
    reasons,
    score: Math.max(0, score),
  };
}

/**
 * 두 문자열 간 유사도 계산 (0~1)
 * Levenshtein 거리 기반
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.trim().toLowerCase();
  const s2 = str2.trim().toLowerCase();

  // 동일하면 1.0
  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0 || len2 === 0) return 0;

  // Levenshtein 거리
  const matrix: number[][] = Array(len2 + 1)
    .fill(null)
    .map(() => Array(len1 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[0][i] = i;
  for (let j = 0; j <= len2; j++) matrix[j][0] = j;

  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }

  const maxLen = Math.max(len1, len2);
  const distance = matrix[len2][len1];

  return 1 - distance / maxLen;
}

/**
 * 여러 번역 쌍에 대한 품질 검사
 */
export function filterHighQualityTranslations(
  translations: Array<{
    id: string;
    source_text: string;
    target_text: string;
    confidence: number;
  }>
): {
  valid: typeof translations;
  invalid: Array<typeof translations[0] & { reason: string }>;
  stats: {
    total: number;
    valid: number;
    invalid: number;
    avgScore: number;
  };
} {
  const valid: typeof translations = [];
  const invalid: Array<typeof translations[0] & { reason: string }> = [];
  let totalScore = 0;

  for (const translation of translations) {
    const check = checkTranslationQuality(
      translation.source_text,
      translation.target_text,
      translation.confidence
    );

    if (check.isValid) {
      valid.push(translation);
    } else {
      invalid.push({
        ...translation,
        reason: check.reasons.join(" | "),
      });
    }

    totalScore += check.score;
  }

  return {
    valid,
    invalid,
    stats: {
      total: translations.length,
      valid: valid.length,
      invalid: invalid.length,
      avgScore: translations.length > 0 ? totalScore / translations.length : 0,
    },
  };
}
