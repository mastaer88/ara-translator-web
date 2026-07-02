import sys
import json
import numpy as np
from PIL import Image, ImageEnhance

try:
    from manga_ocr import MangaOcr
    HAS_MANGA_OCR = True
except ImportError:
    HAS_MANGA_OCR = False

def preprocess_image(image_array):
    """이미지 전처리: 대비 + 선명도 개선 (크기 변경 없음)"""
    pil_image = Image.fromarray(image_array.astype('uint8'))

    # 대비 증가
    enhancer = ImageEnhance.Contrast(pil_image)
    pil_image = enhancer.enhance(2.0)  # 더 강하게

    # 선명도 증가
    enhancer = ImageEnhance.Sharpness(pil_image)
    pil_image = enhancer.enhance(2.0)  # 더 강하게

    return np.array(pil_image)

def normalize_to_rect_box(polygon_box):
    """다각형 박스를 직사각형으로 변환"""
    if isinstance(polygon_box, (list, tuple)):
        xs = [p[0] for p in polygon_box]
        ys = [p[1] for p in polygon_box]
        return (min(xs), min(ys), max(xs), max(ys))
    return polygon_box

def should_merge(box1, box2, threshold=30):
    """두 박스가 충분히 가까운지 확인"""
    x1, y1, x2, y2 = box1
    bx1, by1, bx2, by2 = box2

    # 수평/수직 거리 계산
    gap_x = max(0, max(bx1, x1) - min(bx2, x2))
    gap_y = max(0, max(by1, y1) - min(by2, y2))

    return gap_x <= threshold and gap_y <= threshold

def merge_boxes(boxes):
    """인접한 박스들을 병합"""
    if not boxes:
        return []

    boxes = sorted(boxes, key=lambda b: (b[1], b[0]))  # Y, X 순서로 정렬
    merged = [boxes[0]]

    for box in boxes[1:]:
        if should_merge(merged[-1], box):
            # 병합
            x1, y1, x2, y2 = merged[-1]
            bx1, by1, bx2, by2 = box
            merged[-1] = (min(x1, bx1), min(y1, by1), max(x2, bx2), max(y2, by2))
        else:
            merged.append(box)

    return merged

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: ocr_easyocr.py <image_path> <lang>"}))
        sys.exit(1)

    image_path = sys.argv[1]
    lang = sys.argv[2]

    import easyocr

    # 이미지 로드
    pil_img = Image.open(image_path).convert("RGB")
    image = np.array(pil_img)

    # 전처리
    image = preprocess_image(image)
    image_height, image_width = image.shape[:2]

    # EasyOCR로 텍스트 인식 (향상된 설정)
    reader = easyocr.Reader([lang, 'en'], gpu=False, verbose=False)

    regions = []

    try:
        # 상세 모드로 결과 획득
        ocr_result = reader.readtext(image, detail=1)

        # 신뢰도 필터링 (더 낮은 임계값)
        min_confidence = 0.10

        boxes = []
        texts = []

        for (bbox, text, confidence) in ocr_result:
            if confidence < min_confidence or not text.strip():
                continue

            # bbox를 직사각형으로 변환
            box = normalize_to_rect_box(bbox)
            x_min, y_min, x_max, y_max = box

            # 경계 확인
            x_min = max(0, int(x_min))
            y_min = max(0, int(y_min))
            x_max = min(image_width, int(x_max))
            y_max = min(image_height, int(y_max))

            if x_max <= x_min or y_max <= y_min:
                continue

            width = x_max - x_min
            height = y_max - y_min

            # 패딩 추가 (20% 확장)
            padding_x = max(5, int(width * 0.20))
            padding_y = max(5, int(height * 0.20))

            x_padded = max(0, x_min - padding_x)
            y_padded = max(0, y_min - padding_y)
            width_padded = width + padding_x * 2
            height_padded = height + padding_y * 2

            # 이미지 경계 체크
            width_padded = min(width_padded, image_width - x_padded)
            height_padded = min(height_padded, image_height - y_padded)

            boxes.append((x_padded, y_padded, x_padded + width_padded, y_padded + height_padded))
            texts.append({
                "text": text.strip(),
                "confidence": round(float(confidence), 4)
            })

        # 박스 병합 (인접한 것들)
        merged_boxes = merge_boxes(boxes)

        # 결과 생성
        for i, box in enumerate(merged_boxes):
            x_padded, y_padded, x_padded_end, y_padded_end = box
            width_padded = x_padded_end - x_padded
            height_padded = y_padded_end - y_padded

            # 병합된 박스에 대응하는 텍스트 찾기
            text_info = texts[i] if i < len(texts) else {"text": "", "confidence": 0}

            regions.append({
                "x": x_padded,
                "y": y_padded,
                "width": width_padded,
                "height": height_padded,
                "text": text_info["text"],
                "confidence": text_info["confidence"],
            })

    except Exception as e:
        pass

    # 읽기 순서 정렬 (상 → 하, 좌 → 우)
    regions.sort(key=lambda r: (r["y"], r["x"]))

    print(json.dumps({"regions": regions}))

if __name__ == "__main__":
    main()
