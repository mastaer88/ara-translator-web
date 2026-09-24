import { createHash } from "crypto";
import { NextResponse } from "next/server";

/**
 * 전기자전거 주행 기록 동기화 API.
 * 저장소: Upstash Redis (Vercel Storage → Upstash for Redis 연결 시 환경변수 자동 설정)
 * 동기화 코드를 아는 기기끼리 같은 데이터를 공유한다. 코드는 해시해서 키로만 사용한다.
 */

const REDIS_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

const CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const ID_RE = /^[0-9]{1,16}$/;
const MAX_BATCH = 20;
const MAX_RIDE_BYTES = 900_000;

type Command = (string | number)[];

async function redis(commands: Command[]): Promise<unknown[]> {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const out = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = out.find((r) => r.error);
  if (failed) throw new Error(failed.error);
  return out.map((r) => r.result);
}

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function POST(req: Request) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return bad("동기화 저장소가 설정되지 않았습니다 (Vercel → Storage → Upstash Redis 연결 필요)", 503);
  }

  let body: {
    code?: string;
    action?: string;
    ids?: string[];
    rides?: { id: string }[];
    meta?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return bad("잘못된 요청입니다");
  }

  const code = String(body.code ?? "").toUpperCase();
  if (!CODE_RE.test(code)) return bad("동기화 코드 형식이 올바르지 않습니다");
  const ns = `ebike:${createHash("sha256").update(code).digest("hex").slice(0, 32)}`;
  const idsKey = `${ns}:rides`;
  const rideKey = (id: string) => `${ns}:ride:${id}`;

  const ids = (body.ids ?? []).map(String);
  if (ids.length > MAX_BATCH || ids.some((id) => !ID_RE.test(id))) return bad("잘못된 주행 id");

  try {
    switch (body.action) {
      case "pull": {
        const [rideIds, meta] = await redis([
          ["SMEMBERS", idsKey],
          ["GET", `${ns}:meta`],
        ]);
        return NextResponse.json({
          rideIds: rideIds ?? [],
          meta: typeof meta === "string" ? JSON.parse(meta) : null,
        });
      }

      case "getRides": {
        if (ids.length === 0) return NextResponse.json({ rides: [] });
        const [values] = await redis([["MGET", ...ids.map(rideKey)]]);
        const rides = (values as (string | null)[]).filter((v): v is string => !!v).map((v) => JSON.parse(v));
        return NextResponse.json({ rides });
      }

      case "putRides": {
        const rides = body.rides ?? [];
        if (rides.length === 0) return NextResponse.json({ ok: true });
        if (rides.length > MAX_BATCH) return bad("한 번에 너무 많은 기록입니다");
        const cmds: Command[] = [];
        for (const ride of rides) {
          const id = String(ride?.id ?? "");
          if (!ID_RE.test(id)) return bad("잘못된 주행 기록");
          const json = JSON.stringify(ride);
          if (json.length > MAX_RIDE_BYTES) return bad("주행 기록이 너무 큽니다");
          cmds.push(["SET", rideKey(id), json], ["SADD", idsKey, id]);
        }
        await redis(cmds);
        return NextResponse.json({ ok: true });
      }

      case "deleteRides": {
        if (ids.length === 0) return NextResponse.json({ ok: true });
        await redis([["DEL", ...ids.map(rideKey)], ["SREM", idsKey, ...ids]]);
        return NextResponse.json({ ok: true });
      }

      case "putMeta": {
        const json = JSON.stringify(body.meta ?? null);
        if (json.length > 200_000) return bad("데이터가 너무 큽니다");
        await redis([["SET", `${ns}:meta`, json]]);
        return NextResponse.json({ ok: true });
      }

      default:
        return bad("알 수 없는 요청입니다");
    }
  } catch (err) {
    console.error("ebike sync error", err);
    return bad("동기화 서버 오류", 502);
  }
}
