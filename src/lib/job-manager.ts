import db from "./db";
import { randomUUID } from "crypto";

export type JobType = "ocr" | "translate" | "validate" | "export";
export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  project_id: string;
  page_id: string;
  region_id?: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  result?: string;
  error_msg?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

/**
 * 새 작업 생성
 */
export function createJob(
  projectId: string,
  pageId: string,
  type: JobType,
  regionId?: string
): Job {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO jobs (id, project_id, page_id, region_id, type, status, progress, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).run(id, projectId, pageId, regionId || null, type, now, now);

  return {
    id,
    project_id: projectId,
    page_id: pageId,
    region_id: regionId,
    type,
    status: "pending",
    progress: 0,
    created_at: now,
    updated_at: now,
  };
}

/**
 * 작업 상태 업데이트
 */
export function updateJobStatus(
  jobId: string,
  status: JobStatus,
  progress: number = 0,
  result?: string,
  error?: string
): Job | null {
  const now = new Date().toISOString();
  const completedAt = status === "completed" || status === "failed" ? now : null;

  db.prepare(
    `UPDATE jobs
     SET status = ?, progress = ?, result = ?, error_msg = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`
  ).run(status, progress, result || null, error || null, now, completedAt, jobId);

  return getJob(jobId);
}

/**
 * 특정 작업 조회
 */
export function getJob(jobId: string): Job | null {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | null;
}

/**
 * 프로젝트의 모든 작업 조회
 */
export function getJobsByProject(projectId: string): Job[] {
  return db.prepare(
    "SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50"
  ).all(projectId) as Job[];
}

/**
 * 진행 중인 작업 (모든 프로젝트)
 */
export function getRunningJobs(): Job[] {
  return db.prepare(
    `SELECT * FROM jobs
     WHERE status IN ('pending', 'running')
     ORDER BY created_at DESC`
  ).all() as Job[];
}

/**
 * 최근 완료된 작업
 */
export function getRecentJobs(limit: number = 20): Job[] {
  return db.prepare(
    `SELECT * FROM jobs
     WHERE status IN ('completed', 'failed')
     ORDER BY completed_at DESC
     LIMIT ?`
  ).all(limit) as Job[];
}

/**
 * 프로젝트별 작업 통계
 */
export function getJobStats(projectId: string): {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
} {
  const result = db.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
     FROM jobs
     WHERE project_id = ?`
  ).get(projectId) as {
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
  };

  return {
    total: result.total || 0,
    completed: result.completed || 0,
    failed: result.failed || 0,
    running: result.running || 0,
    pending: result.pending || 0,
  };
}

/**
 * LoRA 학습 데이터 통계 초기화/업데이트
 */
export function initializeLoraStats(projectId: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR REPLACE INTO lora_stats
     (id, project_id, total_pairs, reviewed_pairs, high_quality_pairs, training_status, training_progress, created_at, updated_at)
     VALUES (?, ?, 0, 0, 0, 'pending', 0, ?, ?)`
  ).run(id, projectId, now, now);

  return id;
}

/**
 * LoRA 통계 조회
 */
export function getLoraStats(projectId: string) {
  return db.prepare("SELECT * FROM lora_stats WHERE project_id = ?").get(projectId) as {
    id: string;
    project_id: string;
    total_pairs: number;
    reviewed_pairs: number;
    high_quality_pairs: number;
    training_status: string;
    training_progress: number;
    created_at: string;
    updated_at: string;
  } | null;
}

/**
 * LoRA 통계 업데이트
 */
export function updateLoraStats(
  projectId: string,
  updates: {
    total_pairs?: number;
    reviewed_pairs?: number;
    high_quality_pairs?: number;
    training_status?: string;
    training_progress?: number;
  }
) {
  console.log(`[updateLoraStats] Called for project ${projectId}`, updates);
  const now = new Date().toISOString();

  let query = "UPDATE lora_stats SET updated_at = ?";
  const params: any[] = [now];

  if (updates.total_pairs !== undefined) {
    query += ", total_pairs = ?";
    params.push(updates.total_pairs);
  }
  if (updates.reviewed_pairs !== undefined) {
    query += ", reviewed_pairs = ?";
    params.push(updates.reviewed_pairs);
  }
  if (updates.high_quality_pairs !== undefined) {
    query += ", high_quality_pairs = ?";
    params.push(updates.high_quality_pairs);
  }
  if (updates.training_status !== undefined) {
    query += ", training_status = ?";
    params.push(updates.training_status);
  }
  if (updates.training_progress !== undefined) {
    query += ", training_progress = ?";
    params.push(updates.training_progress);
  }

  query += " WHERE project_id = ?";
  params.push(projectId);

  console.log(`[updateLoraStats] Executing query:`, query, params);
  const result = db.prepare(query).run(...params);
  console.log(`[updateLoraStats] Update result:`, result);

  const stats = getLoraStats(projectId);
  console.log(`[updateLoraStats] New stats:`, stats);
  return stats;
}

/**
 * 모든 프로젝트의 LoRA 통계
 */
export function getAllLoraStats() {
  return db.prepare("SELECT * FROM lora_stats ORDER BY updated_at DESC").all() as Array<{
    id: string;
    project_id: string;
    total_pairs: number;
    reviewed_pairs: number;
    high_quality_pairs: number;
    training_status: string;
    training_progress: number;
    created_at: string;
    updated_at: string;
  }>;
}
