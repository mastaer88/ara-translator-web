import { NextRequest, NextResponse } from "next/server";
import { getRunningJobs, getRecentJobs, getAllLoraStats, getJobStats } from "@/lib/job-manager";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const filter = searchParams.get("filter") || "all"; // all, running, recent, lora-stats

  if (filter === "running") {
    // 모든 프로젝트의 진행 중인 작업
    const jobs = getRunningJobs();
    return NextResponse.json({ jobs });
  }

  if (filter === "recent") {
    // 최근 완료/실패 작업
    const jobs = getRecentJobs(20);
    return NextResponse.json({ jobs });
  }

  if (filter === "lora-stats") {
    // 모든 프로젝트의 LoRA 학습 데이터 통계
    const stats = getAllLoraStats();
    return NextResponse.json({ stats });
  }

  // 전체 요약
  const running = getRunningJobs();
  const recent = getRecentJobs(10);
  const loraStats = getAllLoraStats();

  return NextResponse.json({
    running,
    recent,
    loraStats,
    timestamp: new Date().toISOString(),
  });
}
