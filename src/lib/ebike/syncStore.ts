/**
 * 동기화 데이터 저장소 (서버 전용).
 * - PC(로컬 서버): data/app.db SQLite + data/ebike-gpx/ 에 GPX 파일
 * - Vercel 등: Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN 설정 시)
 */
import fs from "fs";
import path from "path";
import { rideToGpx } from "./gpx";
import type { RideRecord } from "./rideStore";

export interface SyncStore {
  kind: "pc" | "redis";
  pull(ns: string): Promise<{ rideIds: string[]; meta: unknown }>;
  getRides(ns: string, ids: string[]): Promise<unknown[]>;
  putRides(ns: string, rides: { id: string; json: string }[]): Promise<void>;
  deleteRides(ns: string, ids: string[]): Promise<void>;
  putMeta(ns: string, json: string): Promise<void>;
}

// ───────────────────────── Upstash Redis ─────────────────────────

function redisStore(url: string, token: string): SyncStore {
  type Command = (string | number)[];
  const redis = async (commands: Command[]): Promise<unknown[]> => {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    const failed = out.find((r) => r.error);
    if (failed) throw new Error(failed.error);
    return out.map((r) => r.result);
  };
  const idsKey = (ns: string) => `${ns}:rides`;
  const rideKey = (ns: string, id: string) => `${ns}:ride:${id}`;

  return {
    kind: "redis",
    async pull(ns) {
      const [rideIds, meta] = await redis([
        ["SMEMBERS", idsKey(ns)],
        ["GET", `${ns}:meta`],
      ]);
      return {
        rideIds: (rideIds as string[]) ?? [],
        meta: typeof meta === "string" ? JSON.parse(meta) : null,
      };
    },
    async getRides(ns, ids) {
      if (ids.length === 0) return [];
      const [values] = await redis([["MGET", ...ids.map((id) => rideKey(ns, id))]]);
      return (values as (string | null)[]).filter((v): v is string => !!v).map((v) => JSON.parse(v));
    },
    async putRides(ns, rides) {
      if (rides.length === 0) return;
      await redis(rides.flatMap((r) => [["SET", rideKey(ns, r.id), r.json], ["SADD", idsKey(ns), r.id]]));
    },
    async deleteRides(ns, ids) {
      if (ids.length === 0) return;
      await redis([["DEL", ...ids.map((id) => rideKey(ns, id))], ["SREM", idsKey(ns), ...ids]]);
    },
    async putMeta(ns, json) {
      await redis([["SET", `${ns}:meta`, json]]);
    },
  };
}

// ───────────────────────── PC 로컬 (SQLite + GPX 파일) ─────────────────────────

const gpxRoot = path.join(process.cwd(), "data", "ebike-gpx");

function gpxPath(ns: string, ride: RideRecord) {
  const d = new Date(ride.startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}_${(ride.distance / 1000).toFixed(1)}km_${ride.id}.gpx`;
  return path.join(gpxRoot, ns.replace(/[^a-z0-9]/gi, ""), name);
}

async function pcStore(): Promise<SyncStore> {
  // 번역기와 같은 data/app.db 사용 (PC에서만 로드)
  const db = (await import("@/lib/db")).default;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ebike_sync_rides (
      ns TEXT NOT NULL,
      id TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ns, id)
    );
    CREATE TABLE IF NOT EXISTS ebike_sync_meta (
      ns TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return {
    kind: "pc",
    async pull(ns) {
      const ids = db.prepare("SELECT id FROM ebike_sync_rides WHERE ns = ?").all(ns) as { id: string }[];
      const meta = db.prepare("SELECT json FROM ebike_sync_meta WHERE ns = ?").get(ns) as
        | { json: string }
        | undefined;
      return { rideIds: ids.map((r) => r.id), meta: meta ? JSON.parse(meta.json) : null };
    },
    async getRides(ns, ids) {
      if (ids.length === 0) return [];
      const rows = db
        .prepare(`SELECT json FROM ebike_sync_rides WHERE ns = ? AND id IN (${ids.map(() => "?").join(",")})`)
        .all(ns, ...ids) as { json: string }[];
      return rows.map((r) => JSON.parse(r.json));
    },
    async putRides(ns, rides) {
      const now = new Date().toISOString();
      const upsert = db.prepare(
        `INSERT INTO ebike_sync_rides (ns, id, json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(ns, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      );
      db.transaction(() => {
        for (const r of rides) upsert.run(ns, r.id, r.json, now);
      })();
      // PC에서 바로 열어볼 수 있도록 GPX 파일도 저장
      for (const r of rides) {
        try {
          const ride = JSON.parse(r.json) as RideRecord;
          const file = gpxPath(ns, ride);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, rideToGpx(ride));
        } catch (err) {
          console.warn("GPX 저장 실패", r.id, err);
        }
      }
    },
    async deleteRides(ns, ids) {
      if (ids.length === 0) return;
      db.prepare(`DELETE FROM ebike_sync_rides WHERE ns = ? AND id IN (${ids.map(() => "?").join(",")})`).run(
        ns,
        ...ids,
      );
      const dir = path.join(gpxRoot, ns.replace(/[^a-z0-9]/gi, ""));
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (ids.some((id) => f.endsWith(`_${id}.gpx`))) fs.rmSync(path.join(dir, f), { force: true });
        }
      }
    },
    async putMeta(ns, json) {
      db.prepare(
        `INSERT INTO ebike_sync_meta (ns, json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(ns) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      ).run(ns, json, new Date().toISOString());
    },
  };
}

/** 사용할 저장소. 없으면 null (예: 저장소 설정이 없는 Vercel) */
export async function getSyncStore(): Promise<SyncStore | null> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url, token);
  if (process.env.VERCEL) return null; // Vercel 서버는 파일을 영구 저장할 수 없음
  return pcStore();
}
