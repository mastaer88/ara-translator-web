import { useEffect, useState, useCallback } from "react";

export type Job = {
  id: string;
  project_id: string;
  page_id: string;
  type: "ocr" | "translate";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  error_msg?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
};

export function useJobMonitor(projectId?: string, interval = 500) {
  const [runningJobs, setRunningJobs] = useState<Job[]>([]);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs?filter=running");
      const data = await response.json();

      let running = data.jobs || [];

      if (projectId) {
        // 특정 프로젝트의 작업만 필터링
        running = running.filter((j: Job) => j.project_id === projectId);
      }

      setRunningJobs(running);

      // 최근 작업도 가져오기
      const recentResponse = await fetch("/api/jobs?filter=recent");
      const recentData = await recentResponse.json();
      let recent = recentData.jobs || [];

      if (projectId) {
        recent = recent.filter((j: Job) => j.project_id === projectId);
      }

      setRecentJobs(recent);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  }, [projectId]);

  useEffect(() => {
    // 초기 로드
    fetchJobs();

    // 자동 갱신 (진행 중인 작업이 있을 때)
    const timer = setInterval(() => {
      fetchJobs();
    }, interval);

    return () => clearInterval(timer);
  }, [fetchJobs, interval]);

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      const response = await fetch("/api/jobs/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });

      if (response.ok) {
        await fetchJobs();
        return true;
      }
      return false;
    } catch (err) {
      console.error("Failed to cancel job:", err);
      return false;
    }
  }, [fetchJobs]);

  return {
    runningJobs,
    recentJobs,
    fetchJobs,
    cancelJob,
    hasRunningJobs: runningJobs.length > 0,
  };
}
