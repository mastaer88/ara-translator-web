#!/usr/bin/env python3
"""
LoRA 학습 데이터 분석 및 프롬프트 개선 스크립트
"""

import json
import sys
from pathlib import Path
from collections import defaultdict

def analyze_lora_data(jsonl_path: str):
    """LoRA 학습 데이터 분석"""
    data_file = Path(jsonl_path)
    if not data_file.exists():
        print(f"❌ 파일을 찾을 수 없습니다: {jsonl_path}")
        sys.exit(1)

    pairs = []
    stats = {
        'total': 0,
        'reviewed': 0,
        'by_lang_pair': defaultdict(int),
        'by_confidence': {'high': 0, 'medium': 0, 'low': 0},
        'avg_source_len': 0,
        'avg_target_len': 0,
    }

    try:
        with open(data_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                pair = json.loads(line)
                pairs.append(pair)
                stats['total'] += 1
                if pair.get('reviewed'):
                    stats['reviewed'] += 1

                lang_pair = f"{pair['source_lang']}->{pair['target_lang']}"
                stats['by_lang_pair'][lang_pair] += 1

                conf = pair.get('confidence', 1.0)
                if conf >= 0.8:
                    stats['by_confidence']['high'] += 1
                elif conf >= 0.5:
                    stats['by_confidence']['medium'] += 1
                else:
                    stats['by_confidence']['low'] += 1

                stats['avg_source_len'] += len(pair['source_text'])
                stats['avg_target_len'] += len(pair['target_text'])
    except json.JSONDecodeError as e:
        print(f"❌ JSON 파싱 오류: {e}")
        sys.exit(1)

    if stats['total'] == 0:
        print("⚠️ 학습 데이터가 없습니다")
        return

    stats['avg_source_len'] /= stats['total']
    stats['avg_target_len'] /= stats['total']

    print("=" * 60)
    print("📚 LoRA 학습 데이터 분석")
    print("=" * 60)
    print(f"📊 전체 항목: {stats['total']}개")
    print(f"✅ 검수 완료: {stats['reviewed']}개 ({stats['reviewed']*100//max(stats['total'], 1)}%)")
    print()
    print("🌐 언어쌍 분포:")
    for lang_pair, count in sorted(stats['by_lang_pair'].items(), key=lambda x: x[1], reverse=True):
        print(f"  {lang_pair}: {count}개")
    print()
    print("⭐ 신뢰도 분포:")
    print(f"  높음 (≥0.8): {stats['by_confidence']['high']}개")
    print(f"  중간 (0.5-0.8): {stats['by_confidence']['medium']}개")
    print(f"  낮음 (<0.5): {stats['by_confidence']['low']}개")
    print()
    print("📏 평균 길이:")
    print(f"  원문: {stats['avg_source_len']:.1f}자")
    print(f"  번역: {stats['avg_target_len']:.1f}자")
    print()

    # 샘플 데이터 표시
    if pairs:
        print("📋 샘플 데이터 (최근 3개):")
        print("-" * 60)
        for pair in pairs[-3:]:
            print(f"원문: {pair['source_text']}")
            print(f"번역: {pair['target_text']}")
            print(f"신뢰도: {pair.get('confidence', 1.0):.2f}, 검수: {'✅' if pair.get('reviewed') else '❌'}")
            print()

def export_for_training(jsonl_path: str, output_format: str = "jsonl"):
    """학습용 형식으로 내보내기"""
    data_file = Path(jsonl_path)
    if not data_file.exists():
        print(f"❌ 파일을 찾을 수 없습니다: {jsonl_path}")
        sys.exit(1)

    reviewed_pairs = []
    try:
        with open(data_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                pair = json.loads(line)
                if pair.get('reviewed'):
                    reviewed_pairs.append(pair)
    except json.JSONDecodeError as e:
        print(f"❌ JSON 파싱 오류: {e}")
        sys.exit(1)

    if not reviewed_pairs:
        print("⚠️ 검수 완료된 데이터가 없습니다")
        return

    # 검수된 데이터로만 학습용 파일 생성
    output_path = data_file.parent / f"training-reviewed-{data_file.stem}.jsonl"
    with open(output_path, 'w', encoding='utf-8') as f:
        for pair in reviewed_pairs:
            # LoRA 학습용 포맷
            train_pair = {
                'source_lang': pair['source_lang'],
                'target_lang': pair['target_lang'],
                'source_text': pair['source_text'],
                'target_text': pair['target_text'],
            }
            f.write(json.dumps(train_pair, ensure_ascii=False) + '\n')

    print(f"✅ 검수된 {len(reviewed_pairs)}개 데이터를 저장했습니다: {output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("사용법: python lora_train.py <jsonl_file> [--export]")
        print("  분석: python lora_train.py data/lora/training-data.jsonl")
        print("  내보내기: python lora_train.py data/lora/training-data.jsonl --export")
        sys.exit(1)

    jsonl_file = sys.argv[1]

    if '--export' in sys.argv:
        export_for_training(jsonl_file)
    else:
        analyze_lora_data(jsonl_file)
