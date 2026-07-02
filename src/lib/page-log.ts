import db from "./db";
import { randomUUID } from "crypto";

export type PageAction = "ocr" | "translate" | "validate" | "export" | "review";

export function logPageAction(
  pageId: string,
  action: PageAction,
  status: "success" | "error" = "success",
  errorMsg?: string
) {
  db.prepare(
    `INSERT INTO page_logs (id, page_id, action, status, error_msg, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    pageId,
    action,
    status,
    errorMsg || null,
    new Date().toISOString()
  );
}

export function getPageLogs(pageId: string) {
  return db
    .prepare(`SELECT * FROM page_logs WHERE page_id = ? ORDER BY created_at DESC`)
    .all(pageId) as {
    id: string;
    page_id: string;
    action: PageAction;
    status: string;
    error_msg: string | null;
    created_at: string;
  }[];
}

export function getPageProgress(pageId: string) {
  const logs = getPageLogs(pageId);
  const logMap = new Map<PageAction, boolean>();

  for (const log of logs) {
    if (log.status === "success" && !logMap.has(log.action)) {
      logMap.set(log.action, true);
    }
  }

  return {
    ocr: logMap.has("ocr"),
    translated: logMap.has("translate"),
    validated: logMap.has("validate"),
    reviewed: logMap.has("review"),
  };
}
