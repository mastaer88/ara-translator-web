/**
 * 앱 기본 단속 카메라 데이터 만들기.
 * 공공데이터포털 「전국무인교통단속카메라표준데이터」 CSV(EUC-KR 가능)를 받아 실행:
 *   npx tsx scripts/ebike-cameras.mts ~/Downloads/전국무인교통단속카메라표준데이터.csv
 * → public/ebike/cameras.json (주정차 단속·중복 제외, 좌표 소수점 5자리)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseCameras } from "../src/lib/ebike/cameras";

const file = process.argv[2];
if (!file) {
  console.error("사용법: npx tsx scripts/ebike-cameras.mts <CSV 파일>");
  process.exit(1);
}
const buf = readFileSync(file);
let text: string;
try {
  text = new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
} catch {
  text = new TextDecoder("euc-kr").decode(buf);
}
const cameras = parseCameras(text);
// 데이터 기준일: 파일 안의 가장 최근 날짜
const date = (text.match(/20\d\d-\d\d-\d\d/g) ?? []).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
const out = "public/ebike/cameras.json";
writeFileSync(out, JSON.stringify({ date, count: cameras.length, cameras }));
// 앱이 새 데이터를 알아보도록 기준일 상수도 바꿈
const lib = "src/lib/ebike/cameras.ts";
writeFileSync(
  lib,
  readFileSync(lib, "utf8").replace(/BUNDLED_CAMERAS_DATE = "[^"]*"/, `BUNDLED_CAMERAS_DATE = "${date}"`),
);
const kinds = [0, 0, 0, 0];
for (const c of cameras) kinds[c[3]]++;
console.log(
  `${out}: ${cameras.length}개 (기준일 ${date}) · 과속 ${kinds[1]} · 신호 ${kinds[2]} · 신호+과속 ${kinds[3]} · 기타 ${kinds[0]} · 구간단속 ${cameras.filter((c) => c[4]).length}`,
);
