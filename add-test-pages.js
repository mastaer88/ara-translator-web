const db = require('./src/lib/db').default;
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const projectId = '3d4b3a1e-8e38-49ab-97f7-a874d2dc57c5';
const projectDir = path.join(__dirname, 'uploads', projectId);

// 프로젝트 폴더의 이미지 파일 목록
const files = fs.readdirSync(projectDir).filter(f => f.match(/\.(webp|jpg|png)$/i));

console.log(`프로젝트 ID: ${projectId}`);
console.log(`찾은 이미지: ${files.length}개`);

files.forEach((filename, idx) => {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO pages (id, project_id, filename, status, order_index, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  ).run(id, projectId, filename, idx, now);

  console.log(`✓ 페이지 ${idx + 1}: ${filename}`);
});

console.log(`\n✅ ${files.length}개 페이지 추가 완료`);
process.exit(0);
