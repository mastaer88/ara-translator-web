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

- **안전·편의**: 야간 지도 자동 전환, 진행 방향 위 지도, 속도계 크게 보기·가로 모드, 회전 지점 진행 막대,
  배터리 잔량·주행 가능 거리(소모량 자동 학습), 날씨·맞바람 안내, 넘어짐 감지·긴급 SOS, 주행 그래프·1km 구간 기록

- **🔋 배터리 절약 경로 · 보조 단계 코치**: 여러 경로의 오르막·거리·바람·무게로 배터리 사용량을 계산해
  가장 적게 드는 길을 고르고, 단계별 도착 시 잔량을 보여줌. 주행 중 1km마다 다시 계산해 단계 조절을 음성 안내.
  자전거 모델 프리셋: 모토벨로 TX8 PRO3 (15/20Ah, 속도 제한 해제 버전 포함)
- **📍 경유지**: 검색·주변 찾기 결과의 “+ 경유”로 최대 3곳까지 들러 가기 (도착하면 음성 안내 후 다음 경유지로)
- **🎙 음성 명령** (지도 오른쪽 아래 마이크 버튼): “집으로”, “회사로”, “○○ 가자”, “편의점 찾아줘”, “주차 위치 저장”,
  “주차 위치로”, “배터리 얼마야”, “도착 언제야”, “날씨 어때”, “안내 종료”, “주행 시작/종료”, “도와줘”(SOS).
  아이폰 설정에서 Safari 마이크·음성 인식 권한이 필요합니다.
- **🖼 주행 요약 이미지**: 기록 → 주행 선택 → 코스 지도와 기록을 담은 이미지를 사진에 저장하거나 공유
- **📊 월별 통계**: 기록 → 월별 통계 탭 (최근 12개월 거리 그래프·월별 표·올해 합계, PC에서도 같은 동기화 코드로 확인)
- **🏍 오토바이 모드** (설정 → 차종): 고속도로·자동차전용도로·자전거도로를 뺀 이륜차 경로(BRouter `moped`),
  연료 잔량·주행 가능 거리(가득 주유 때 넣은 양으로 연비 학습), 주유소·오토바이 센터 찾기,
  정비 알림(엔진오일 등, 켜고 끄기·주기 변경 가능, 계기판 km 기준), 단속 카메라 음성 경고
  (공공데이터포털 「전국무인교통단속카메라표준데이터」 CSV를 불러오기)

### 카카오 장소 검색 (선택)

[Kakao Developers](https://developers.kakao.com)에서 애플리케이션을 만들고 **REST API 키**를 받아
Vercel → 프로젝트 → Settings → Environment Variables에 `KAKAO_REST_API_KEY`로 넣고 다시 배포하세요
(PC 서버는 `.env.local`). 앱 설정에서 **카카오맵 → 사용 설정 ON**이 필요합니다.
키가 없으면 OpenStreetMap 검색을 사용합니다.

키를 넣으면 쓰는 카카오맵 API:

| 기능 | 카카오 API | 키가 없을 때 |
|---|---|---|
| 장소·주소 검색, 좌표 → 주소 | 키워드 / 주소 검색, coord2address | OpenStreetMap |
| 주변 찾기 (편의점·화장실·자전거 수리·카페 등) | 카테고리 / 키워드 장소 검색 (가까운 순) | 사용 불가 |
| "카카오 자전거" 경로 옵션 | `/v2/routing/bicycle` | 자전거도로 우선(BRouter) |
| 주차 위치까지 걷기 안내 | `/v2/routing/walk` | OSRM 도보 |

### 기록을 PC에 저장하기 (동기화)

PC에서 서버(`dev.bat`)가 켜져 있으면 동기화한 주행 기록이 PC에 저장됩니다.

- 데이터베이스: `data/app.db` (번역기와 같은 파일, `ebike_sync_*` 테이블)
- GPX 파일: `data/ebike-gpx/` (주행마다 한 개, Strava·Garmin 등에서 열 수 있음)

아이폰(Vercel 주소)에서 PC에 접속하려면 **https 주소**가 필요합니다. 가장 쉬운 방법은 Tailscale(무료)입니다.

1. PC와 아이폰에 Tailscale을 설치하고 같은 계정으로 로그인
2. Tailscale 관리 화면 → DNS에서 **MagicDNS**와 **HTTPS Certificates** 켜기
3. PC에서 `dev.bat` 실행 후, 명령 프롬프트에서 `tailscale serve --bg 3000`
4. 나오는 `https://<PC이름>.<tailnet>.ts.net` 주소를 앱 **설정 → 기록 저장 PC 주소**에 입력 → 저장·확인

PC가 꺼져 있거나 아이폰의 Tailscale이 꺼져 있으면 기록은 폰에 남아 있다가 다음 동기화 때 올라갑니다.
PC 브라우저에서 `http://localhost:3000/ebike`를 열고 같은 동기화 코드를 입력하면 PC에서도 기록을 볼 수 있습니다.

(선택) PC 대신 온라인에 저장하려면 Vercel → Storage → **Upstash for Redis**를 연결하세요.
`KV_REST_API_URL`/`KV_REST_API_TOKEN`이 설정되면 그 서버는 Redis에 저장합니다.
