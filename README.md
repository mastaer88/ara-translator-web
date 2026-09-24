This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 전기자전거 속도계 · 내비 (`/ebike`)

아이폰 Safari에서 `https://<서버주소>/ebike` 접속 → 공유 → **홈 화면에 추가** 하면 앱처럼 사용할 수 있습니다.
(위치 권한은 HTTPS 에서만 동작합니다.)

- **속도계**: GPS 실시간 속도, 주행 거리·시간·평균·최고 속도, 주행 중 화면 꺼짐 방지
- **음성 안내**: 시간/거리 주기 속도 안내, 제한 속도(기본 25km/h) 초과 경고, 목소리·속도·음량 설정
- **지도**: OpenStreetMap + CyclOSM 자전거도로 레이어, 내 위치 따라가기
- **길찾기**: 장소 검색 또는 지도에서 선택 → BRouter 자전거 경로
  (자전거도로 우선 / 균형 / 빠른 길), 경로의 자전거도로 비율 표시,
  회전 음성 안내, 경로 이탈 시 자동 재탐색 (BRouter 실패 시 OSRM 자전거 경로 사용)

- **주행 기록**: 코스 자동 저장, 누적·주간·월간 거리, 지도에서 코스 보기, GPX 내보내기
- **즐겨찾기·주차 위치**: 집/회사/즐겨찾기 목적지, 자전거 세운 위치 저장·길찾기
- **백업·동기화**: 백업 파일 저장/불러오기, 동기화 코드로 여러 기기 간 기록 공유

웹앱이라 화면이 꺼지거나 다른 앱으로 전환하면 위치 추적·음성 안내가 멈춥니다.

### 여러 기기 동기화 설정 (한 번만)

Vercel 대시보드 → 프로젝트 → **Storage** → **Create Database** → **Upstash for Redis**(무료)를 만들고
이 프로젝트에 연결한 뒤 다시 배포하세요. `KV_REST_API_URL`, `KV_REST_API_TOKEN` 환경변수가 자동으로 추가되며,
`/api/ebike/sync`가 이를 사용합니다. (`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` 이름도 지원)
