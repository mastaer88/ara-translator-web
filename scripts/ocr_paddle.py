import sys
import json
import numpy as np
from PIL import Image, ImageEnhance

def preprocess_image(image_array):
    """이미지 전처리"""
    pil_image = Image.fromarray(image_array.astype('uint8'))

    # 대비 증가
    enhancer = ImageEnhance.Contrast(pil_image)
    pil_image = enhancer.enhance(2.0)

    # 선명도 증가
    enhancer = ImageEnhance.Sharpness(pil_image)
    pil_image = enhancer.enhance(2.0)

    return np.array(pil_image)

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: ocr_paddle.py <image_path> <lang>"}))
        sys.exit(1)

    image_path = sys.argv[1]
    lang = sys.argv[2]

    try:
        from paddleocr import PaddleOCR
        import sys
        print(f"✓ PaddleOCR imported", file=sys.stderr)
    except ImportError as e:
        print(json.dumps({"error": f"PaddleOCR not installed: {e}"}))
        sys.exit(1)

    try:
        # 이미지 로드
        pil_img = Image.open(image_path).convert("RGB")
        image_np = np.array(pil_img)
        print(f"✓ Image loaded: {image_np.shape}", file=sys.stderr)

        # 전처리
        image = preprocess_image(image_np)
        print(f"✓ Image preprocessed", file=sys.stderr)

        # PaddleOCR 초기화 (언어는 ch로 통일해서 테스트)
        print(f"✓ Initializing PaddleOCR with lang=ch", file=sys.stderr)
        ocr = PaddleOCR(use_angle_cls=True, lang='ch')
        print(f"✓ PaddleOCR initialized", file=sys.stderr)

        # PaddleOCR 실행
        print(f"✓ Running OCR...", file=sys.stderr)
        result = ocr.ocr(image, cls=True)
        print(f"✓ OCR completed, result type: {type(result)}, len: {len(result) if result else 0}", file=sys.stderr)

        regions = []

        if result:
            for line_idx, line in enumerate(result):
                if line is None:
                    continue

                print(f"  Line {line_idx}: {len(line) if line else 0} items", file=sys.stderr)

                for item_idx, item in enumerate(line):
                    try:
                        bbox, (text, confidence) = item
                        print(f"    Item {item_idx}: text='{text[:20]}', conf={confidence}", file=sys.stderr)

                        if confidence < 0.1 or not text.strip():
                            continue

                        # bbox 정규화
                        xs = [p[0] for p in bbox]
                        ys = [p[1] for p in bbox]
                        x_min, y_min = int(min(xs)), int(min(ys))
                        x_max, y_max = int(max(xs)), int(max(ys))

                        width = x_max - x_min
                        height = y_max - y_min

                        if width <= 0 or height <= 0:
                            continue

                        # 패딩 추가
                        padding_x = max(5, int(width * 0.25))
                        padding_y = max(5, int(height * 0.25))

                        x_padded = max(0, x_min - padding_x)
                        y_padded = max(0, y_min - padding_y)
                        width_padded = width + padding_x * 2
                        height_padded = height + padding_y * 2

                        regions.append({
                            "x": x_padded,
                            "y": y_padded,
                            "width": width_padded,
                            "height": height_padded,
                            "text": text.strip(),
                            "confidence": round(float(confidence), 4),
                        })
                        print(f"    ✓ Added region", file=sys.stderr)
                    except Exception as e:
                        print(f"    ✗ Error processing item: {e}", file=sys.stderr)
                        continue

        print(f"✓ Total regions: {len(regions)}", file=sys.stderr)

        # 정렬
        regions.sort(key=lambda r: (r["y"], r["x"]))

        print(json.dumps({"regions": regions}))

    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"✗ Error: {error_msg}", file=sys.stderr)
        print(json.dumps({"error": error_msg}))
        sys.exit(1)

if __name__ == "__main__":
    main()
