# 🦙 LoRA 학습 데이터 구축 가이드

## 개요

아라 번역은 사용자 번역 데이터를 자동으로 수집하여 **LoRA (Low-Rank Adaptation)** 학습 데이터를 구축합니다. 이를 통해 만화 번역 특화 모델을 구성할 수 있습니다.

---

## 1️⃣ 데이터 수집 흐름

### 자동 수집
1. **번역 실행** → `/api/translate` 호출 시 모든 번역 결과가 `translation_pairs` 테이블에 자동 저장
2. **검수 완료** → UI에서 각 카드의"✓ 검수 완료" 버튼 클릭 시 `reviewed=1` 표시
3. **LoRA 데이터** → 검수 완료한 항목들이 JSONL 형식으로 누적

### 데이터 구조 (JSONL)
```json
{
  "source_lang": "ja",
  "target_lang": "ko",
  "source_text": "こんにちは",
  "target_text": "안녕하세요",
  "confidence": 0.95,
  "reviewed": true
}
```

---

## 2️⃣ LoRA 데이터 관리

### 다운로드
```bash
# UI에서 "📚 LoRA 데이터 다운로드" 버튼 클릭
# 또는 API 직접 호출:
curl "http://localhost:3000/api/lora/export?projectId=<id>&onlyReviewed=true" \
  > training-data.jsonl
```

### 분석
```bash
python scripts/lora_train.py data/lora/training-data.jsonl

# 출력 예:
# 📚 LoRA 학습 데이터 분석
# 📊 전체 항목: 150개
# ✅ 검수 완료: 120개 (80%)
# 🌐 언어쌍 분포:
#   ja->ko: 120개
#   en->ko: 30개
# ⭐ 신뢰도 분포:
#   높음 (≥0.8): 100개
#   중간 (0.5-0.8): 40개
#   낮음 (<0.5): 10개
```

### 학습용 포맷 생성
```bash
# 검수 완료한 데이터만 추출
python scripts/lora_train.py data/lora/training-data.jsonl --export
# → training-reviewed-training-data.jsonl 생성
```

---

## 3️⃣ LLM 기반 OCR 개선

### LLM 검증 (Phase 2)
```bash
# UI: "✓ LLM 검증" 버튼 클릭
# 신뢰도 < 0.7인 OCR 결과를 Ollama로 재검증
# 프롬프트: "OCR 신뢰도가 낮습니다. 문맥상 올바른 텍스트는?"
```

### API 직접 호출
```bash
curl -X POST http://localhost:3000/api/ocr/validate \
  -H "Content-Type: application/json" \
  -d '{"pageId": "<id>"}'

# 응답:
# {
#   "validated": 5,
#   "regions": [...]
# }
```

---

## 4️⃣ LoRA 모델 학습 (프롬프트 개선)

### 기본 전략
현재 Ollama는 직접적인 LoRA 파인튜닝을 지원하지 않으므로, 다음 방식을 사용합니다:

1. **프롬프트 엔지니어링**: 학습 데이터 통계 기반 프롬프트 최적화
2. **문맥 확충**: 역번역 + 검수 데이터로 프롬프트에 In-Context Example 추가
3. **외부 도구 통합** (선택사항):
   - **LLaMA-Factory**: Ollama 모델 로컬 파인튜닝
   - **Ollama 임베딩**: 검색 보강 (RAG) 방식

### 전략 1️⃣: 동적 프롬프트 생성

```python
# 학습 데이터로 프롬프트 개선
import json

def build_context_prompt(lang_pair, sample_count=3):
    """학습 데이터로 문맥 예시 생성"""
    with open('training-reviewed.jsonl', 'r') as f:
        examples = [json.loads(line) for line in f if line.strip()]
    
    # 같은 언어쌍만 필터링
    same_pair = [e for e in examples 
                 if e['source_lang'] + '->' + e['target_lang'] == lang_pair]
    
    # 샘플 추가
    context = "다음은 참고할 번역 예시입니다:\n"
    for ex in same_pair[:sample_count]:
        context += f"원문: {ex['source_text']}\n"
        context += f"번역: {ex['target_text']}\n\n"
    
    return context
```

### 전략 2️⃣: 역번역 검증 (선택)

```python
# 번역 품질 검증
def validate_translation(source, target, source_lang, target_lang):
    """역번역으로 번역 품질 검증"""
    # 1. 번역문을 원문 언어로 역번역
    # 2. 역번역 결과와 원문 유사도 비교
    # 3. 70% 이상 유사하면 학습 데이터로 추가
    pass
```

---

## 5️⃣ 모니터링

### 통계 조회
```bash
# 프로젝트별 LoRA 데이터 현황
curl "http://localhost:3000/api/lora/stats?projectId=<id>"

# 응답:
# {
#   "total": 150,
#   "reviewed": 120,
#   "byLangPair": {
#     "ja->ko": 120,
#     "en->ko": 30
#   },
#   "byConfidence": {
#     "high": 100,
#     "medium": 40,
#     "low": 10
#   }
# }
```

### 데이터 품질 지표
- **검수율**: reviewed / total
- **신뢰도**: confidence ≥ 0.8 비율
- **언어쌍 균형**: 각 언어쌍별 데이터 분포

---

## 6️⃣ 실무 워크플로우

```
1️⃣ OCR 실행
   ↓
2️⃣ LLM 검증 (선택) → 신뢰도 낮은 부분 개선
   ↓
3️⃣ 번역 실행 → 자동 LoRA 데이터 수집
   ↓
4️⃣ UI에서 "✓ 검수 완료" 클릭
   ↓
5️⃣ "📚 LoRA 데이터 다운로드"
   ↓
6️⃣ 데이터 분석 및 프롬프트 개선
   ↓
7️⃣ 개선된 프롬프트로 다음 배치 번역
   ↓
(반복)
```

---

## 7️⃣ 고급: 외부 도구 연동

### LLaMA-Factory로 파인튜닝 (선택)

```bash
# 설치
pip install llama-factory

# Ollama 모델을 LLaMA-Factory로 파인튜닝
# (구체적 설정은 별도 문서 참고)
```

### Ollama 임베딩 + RAG

```python
# 검색 강화 (Retrieval-Augmented Generation)
import requests

def translate_with_rag(text, lang_pair, top_k=3):
    """유사 번역 예시로 프롬프트 강화"""
    # 1. 원문의 임베딩 생성
    # 2. LoRA 데이터에서 유사 문장 검색
    # 3. 상위 K개를 프롬프트에 추가
    # 4. 번역 API 호출
    pass
```

---

## 📌 요약

| 단계 | 액션 | 자동/수동 |
|------|------|---------|
| 데이터 수집 | 번역 실행 | ✅ 자동 |
| 데이터 검수 | UI 버튼 클릭 | 🙋 수동 |
| OCR 개선 | "LLM 검증" 실행 | 🙋 수동 |
| 데이터 분석 | 스크립트 실행 | 🙋 수동 |
| 프롬프트 개선 | 분석 결과 반영 | 🙋 수동 |
| 성능 향상 | 개선된 프롬프트 사용 | ✅ 자동 |

---

**다음 단계**: LoRA 데이터 구축 → 프롬프트 최적화 → 반복 개선
