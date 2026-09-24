import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getSyncStore } from "@/lib/ebike/syncStore";

/**
 * 전기자전거 주행 기록 동기화 API.
 * PC에서 실행하면 PC(data/app.db)에, Vercel에 Upstash Redis를 연결하면 Redis에 저장한다.
 * 동기화 코드를 아는 기기끼리 같은 데이터를 공유한다. 코드는 해시해서 키로만 사용한다.
 * 아이폰 앱(Vercel 주소)이 PC 서버를 부를 수 있도록 CORS를 허용한다.
 */

const CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const ID_RE = /^[0-9]{1,16}$/;
const MAX_BATCH = 20;
const MAX_RIDE_BYTES = 900_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: CORS });
const bad = (message: string, status = 400) => json({ error: message }, status);

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** 연결 확인용: 어떤 저장소를 쓰는지 알려줌 */
export async function GET() {
  const store = await getSyncStore().catch(() => null);
  return json({ ok: !!store, storage: store?.kind ?? null });
}

export async function POST(req: Request) {
  let store;
  try {
    store = await getSyncStore();
  } catch (err) {
    console.error("ebike sync store error", err);
    return bad("저장소를 열 수 없습니다", 500);
  }
  if (!store) {
    return bad("이 서버에는 기록 저장소가 없습니다. 설정에서 PC 서버 주소를 입력하세요.", 503);
  }

  let body: { code?: string; action?: string; ids?: string[]; rides?: { id: string }[]; meta?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("잘못된 요청입니다");
  }

  const code = String(body.code ?? "").toUpperCase();
  if (!CODE_RE.test(code)) return bad("동기화 코드 형식이 올바르지 않습니다");
  const ns = `ebike:${createHash("sha256").update(code).digest("hex").slice(0, 32)}`;

  const ids = (body.ids ?? []).map(String);
  if (ids.length > MAX_BATCH || ids.some((id) => !ID_RE.test(id))) return bad("잘못된 주행 id");

  try {
    switch (body.action) {
      case "pull":
        return json(await store.pull(ns));

      case "getRides":
        return json({ rides: await store.getRides(ns, ids) });

      case "putRides": {
        const rides = body.rides ?? [];
        if (rides.length > MAX_BATCH) return bad("한 번에 너무 많은 기록입니다");
        const items = [];
        for (const ride of rides) {
          const id = String(ride?.id ?? "");
          if (!ID_RE.test(id)) return bad("잘못된 주행 기록");
          const text = JSON.stringify(ride);
          if (text.length > MAX_RIDE_BYTES) return bad("주행 기록이 너무 큽니다");
          items.push({ id, json: text });
        }
        await store.putRides(ns, items);
        return json({ ok: true });
      }

      case "deleteRides":
        await store.deleteRides(ns, ids);
        return json({ ok: true });

      case "putMeta": {
        const text = JSON.stringify(body.meta ?? null);
        if (text.length > 200_000) return bad("데이터가 너무 큽니다");
        await store.putMeta(ns, text);
        return json({ ok: true });
      }

      default:
        return bad("알 수 없는 요청입니다");
    }
  } catch (err) {
    console.error("ebike sync error", err);
    return bad("동기화 서버 오류", 502);
  }
}
