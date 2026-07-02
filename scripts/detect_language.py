#!/usr/bin/env python3
"""
언어 감지 스크립트
OCR 텍스트에서 언어를 자동 감지합니다.
개선된 휴리스틱과 우선순위 기반 감지
"""

import sys
import json
import re

try:
    from langdetect import detect, detect_langs
    has_langdetect = True
except ImportError:
    has_langdetect = False


def count_characters_by_script(text: str) -> dict:
    """문자 타입별 개수 반환"""
    # 일본어 (히라가나 + 카타카나 + 한자)
    hiragana = sum(1 for c in text if '぀' <= c <= 'ゟ')
    katakana = sum(1 for c in text if '゠' <= c <= 'ヿ')
    kanji = sum(1 for c in text if '一' <= c <= '鿿' or '㐀' <= c <= '䶿')
    japanese = hiragana + katakana + kanji

    # 한국어 (한글 + 한자)
    hangul = sum(1 for c in text if '가' <= c <= '힯')
    korean = hangul

    # 키릴 문자 (러시아어)
    cyrillic = sum(1 for c in text if 'Ѐ' <= c <= 'ӿ')

    # 라틴 문자
    latin = sum(1 for c in text if 'a' <= c.lower() <= 'z')

    # 중국어 간체/번체
    chinese = sum(1 for c in text if '一' <= c <= '鿿')

    return {
        "japanese": japanese,
        "korean": korean,
        "cyrillic": cyrillic,
        "latin": latin,
        "chinese": chinese,
        "hiragana": hiragana,
        "katakana": katakana,
        "kanji": kanji,
        "hangul": hangul,
    }


def detect_language(text: str) -> str:
    """
    텍스트에서 언어 코드를 감지합니다.
    반환값: "ja", "ko", "en", "zh", "ru", etc.
    우선순위: 문자 기반 휴리스틱 > langdetect > 기본값
    """
    if not text or not text.strip():
        return "en"

    text = text.strip()[:1000]  # 처음 1000자 사용
    total_chars = len(text)

    if total_chars == 0:
        return "en"

    # 1단계: 문자 기반 휴리스틱 (가장 정확)
    char_counts = count_characters_by_script(text)

    # 히라가나/카타카나가 있으면 강한 신호 (일본어)
    if char_counts["hiragana"] > total_chars * 0.05 or char_counts["katakana"] > total_chars * 0.05:
        return "ja"

    # 한글이 충분히 많으면 한국어
    if char_counts["korean"] > total_chars * 0.15:
        return "ko"

    # 한자만 있는 경우 (중국어일 가능성 높음)
    if char_counts["chinese"] > total_chars * 0.3 and char_counts["korean"] < total_chars * 0.05 and char_counts["hiragana"] == 0 and char_counts["katakana"] == 0:
        return "zh"

    # 키릴 문자 있으면 러시아어
    if char_counts["cyrillic"] > total_chars * 0.1:
        return "ru"

    # 2단계: langdetect 사용
    if has_langdetect:
        try:
            # 확률 기반으로 여러 언어 감지
            detected_langs = detect_langs(text)
            if detected_langs:
                best = detected_langs[0]
                # 신뢰도 0.5 이상이면 사용
                if best.prob > 0.5:
                    return best.lang
        except:
            pass

    # 3단계: 강화된 휴리스틱
    # 일본어: 문자 혼합 (한자 + 히라가나/카타카나)
    if char_counts["japanese"] > total_chars * 0.1:
        # 한자 + 히라가나/카타카나 조합 = 일본어
        if (char_counts["kanji"] > total_chars * 0.02) and (char_counts["hiragana"] + char_counts["katakana"]) > total_chars * 0.02:
            return "ja"
        # 한자만 많으면 (히라가나/카타카나 없음) 중국어 가능성
        if char_counts["kanji"] > total_chars * 0.15:
            return "zh"

    # 라틴 문자 많으면 영어
    if char_counts["latin"] > total_chars * 0.5:
        return "en"

    # 기본값
    return "en"


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "text required", "success": False}))
        sys.exit(1)

    text = sys.argv[1]

    try:
        lang_code = detect_language(text)
        char_counts = count_characters_by_script(text)

        print(json.dumps({
            "language_code": lang_code,
            "success": True,
            "debug": {
                "text_length": len(text),
                "character_counts": char_counts
            }
        }))
    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "success": False
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
