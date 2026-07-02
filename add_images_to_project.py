#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sqlite3
import os
import shutil
import uuid
from datetime import datetime
import sys
import io

# 출력 인코딩 설정
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 설정
db_path = "data/app.db"
source_dir = r"uploads\0a726b3c-6ce4-4d50-be02-b55b3584fd5a"
target_project_id = "8977c443-f3d1-4c35-b9a4-17d60f49cbaa"  # 테스트 프로젝트
target_upload_dir = f"uploads/{target_project_id}"

# 프로젝트 디렉토리 생성
os.makedirs(target_upload_dir, exist_ok=True)

# 이미지 파일 목록
image_files = [f for f in os.listdir(source_dir) if f.endswith(('.webp', '.jpg', '.png'))]

print("[INFO] Found images: {}".format(len(image_files)))

# Database connection
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Add images to project
order_index = 0
for image_file in image_files[:5]:  # Max 5 images
    # Copy image file
    source_path = os.path.join(source_dir, image_file)
    target_path = os.path.join(target_upload_dir, image_file)
    shutil.copy(source_path, target_path)
    print("[OK] Copied: {}".format(image_file))

    # Add to database
    page_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + 'Z'

    cursor.execute(
        """INSERT INTO pages (id, project_id, filename, status, order_index, created_at)
           VALUES (?, ?, ?, 'pending', ?, ?)""",
        (page_id, target_project_id, image_file, order_index, now)
    )
    print("[OK] DB added: {}".format(image_file))
    order_index += 1

conn.commit()
conn.close()

print("\n[DONE] {} images added".format(order_index))
