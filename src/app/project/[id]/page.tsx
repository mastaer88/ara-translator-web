"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

type Job = {
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

type Project = {
  id: string;
  name: string;
  source_lang: string;
  target_lang: string;
};

type Page = {
  id: string;
  project_id: string;
  filename: string;
  status: string;
  width: number | null;
  height: number | null;
};

type Region = {
  id: string;
  page_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  source_text: string;
  translated_text: string;
  confidence: number;
};

type PageLog = {
  id: string;
  action: string;
  status: string;
  created_at: string;
};

const STATUS_META: Record<string, { label: string; emoji: string; className: string }> = {
  pending: { label: "대기중", emoji: "⏳", className: "bg-[var(--color-lavender-light)]" },
  ocr_done: { label: "OCR 완료", emoji: "🔍", className: "bg-[var(--color-mint-light)]" },
  translated: { label: "번역 완료", emoji: "🌐", className: "bg-[var(--color-pink-light)]" },
};

function confidenceBadge(confidence: number) {
  if (confidence >= 0.8) return "bg-[var(--color-mint-light)] text-emerald-700";
  if (confidence >= 0.5) return "bg-[var(--color-butter-light)] text-amber-700";
  return "bg-pink-100 text-rose-600";
}

function getProgressPercent(page: Page, regions: Region[]): number {
  if (!regions.length) return 0;
  const reviewed = regions.filter((r) => !!r.translated_text).length;
  return Math.round((reviewed / regions.length) * 100);
}

export default function ProjectDetail() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [imageDimensions, setImageDimensions] = useState({ w: 0, h: 0 });
  const [logs, setLogs] = useState<PageLog[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [savingRegions, setSavingRegions] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showLeftSidebar, setShowLeftSidebar] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [drawingEnd, setDrawingEnd] = useState<{ x: number; y: number } | null>(null);
  const [runningJobs, setRunningJobs] = useState<Job[]>([]);
  const [hasRunningJobs, setHasRunningJobs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});

  // 진행사항 모니터링 - useEffect로 직접 관리
  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs?filter=running');
      const data = await response.json();
      const jobs = (data.jobs || []).filter((j: Job) => j.project_id === projectId);
      setRunningJobs(jobs);
      setHasRunningJobs(jobs.length > 0);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    }
  }, [projectId]);

  useEffect(() => {
    // 초기 로드
    fetchJobs();

    // 주기적 업데이트 (500ms)
    const interval = setInterval(fetchJobs, 500);

    return () => clearInterval(interval);
  }, [fetchJobs]);

  const cancelJob = async (jobId: string) => {
    try {
      const response = await fetch("/api/jobs/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (response.ok) {
        toast.success("작업이 취소되었습니다!");
        // 최신 jobs 상태 가져오기
        await fetchJobs();
      }
    } catch (err) {
      console.error("Failed to cancel job:", err);
    }
  };

  async function handleDeleteProject() {
    if (!confirm("정말 이 프로젝트를 삭제할까요? 모든 데이터가 제거됩니다.")) return;

    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/");
      }
    } catch (e) {
      setError("프로젝트 삭제 실패");
    }
  }

  async function handleUploadFiles(files: FileList) {
    if (!files || files.length === 0) return;

    setUploading(true);
    const toastId = toast.loading(`📤 ${files.length}개 파일 업로드 중...`);

    try {
      const formData = new FormData();
      formData.append("projectId", projectId);
      Array.from(files).forEach((file) => {
        formData.append("files", file);
      });

      const res = await fetch("/api/pages", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("업로드 실패");

      const data = await res.json();
      const newPages = data.pages || [];

      // 기존 페이지에 새 페이지 추가
      setPages((prev) => [...prev, ...newPages]);

      toast.success(`✅ ${newPages.length}개 파일 추가됨`, { id: toastId });
    } catch (e) {
      toast.error("파일 업로드 실패", {
        id: toastId,
        description: (e as Error).message
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleUpdateProject(updates: { name?: string; source_lang?: string; target_lang?: string }) {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) throw new Error("업데이트 실패");

      const data = await res.json();
      setProject(data.project);
      setShowSettings(false);
      toast.success("✅ 프로젝트 설정이 저장되었습니다");
    } catch (e) {
      toast.error("설정 저장 실패", {
        description: (e as Error).message
      });
    }
  }

  const loadProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    const data = await res.json();
    setProject(data.project);
    setPages(data.pages ?? []);
  }, [projectId]);

  const loadPageDetail = useCallback(async (pageId: string) => {
    const res = await fetch(`/api/pages/${pageId}`);
    const data = await res.json();
    setRegions(data.regions ?? []);
    setSelectedRegionId(null);

    // DB의 width/height를 사용 (OCR 좌표와 일치)
    if (data.page?.width && data.page?.height) {
      setImageDimensions({ w: data.page.width, h: data.page.height });
      console.log(`📄 페이지 로드: ${data.page.filename}`);
      console.log(`   DB 크기: ${data.page.width}x${data.page.height}`);
      console.log(`   OCR 영역 수: ${data.regions?.length ?? 0}`);
      if (data.regions?.length > 0) {
        console.log(`   첫번째 영역: x=${data.regions[0].x}, y=${data.regions[0].y}, w=${data.regions[0].width}, h=${data.regions[0].height}`);
      }
    } else {
      console.warn(`⚠️ 페이지 메타데이터 누락: width=${data.page?.width}, height=${data.page?.height}`);
    }
  }, []);

  useEffect(() => {
    loadProject();
    // 폰트 목록 로드
    loadFonts();
  }, [loadProject]);

  // 폰트 목록 로드
  const loadFonts = async () => {
    try {
      const res = await fetch("/api/fonts");
      const data = await res.json();
      setAvailableFonts(data.fonts || []);
    } catch (e) {
      console.error("폰트 로드 실패:", e);
      // 기본 폰트 설정
      setAvailableFonts([
        { id: "serif", name: "세리프 (전통적)", preview: "전통적이고 우아한 스타일" },
        { id: "sans-serif", name: "산세리프 (현대적)", preview: "깔끔하고 현대적인 스타일" },
      ]);
    }
  };

  // 프로젝트 로드 후 첫 페이지 자동 선택
  useEffect(() => {
    if (pages.length > 0 && !selectedPageId) {
      setSelectedPageId(pages[0].id);
    }
  }, [pages, selectedPageId]);

  useEffect(() => {
    if (selectedPageId) loadPageDetail(selectedPageId);
    else setRegions([]);
  }, [selectedPageId, loadPageDetail]);

  // 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        const currentIdx = pages.findIndex((p) => p.id === selectedPageId);
        if (currentIdx < pages.length - 1) setSelectedPageId(pages[currentIdx + 1].id);
      } else if (e.key === "ArrowLeft") {
        const currentIdx = pages.findIndex((p) => p.id === selectedPageId);
        if (currentIdx > 0) setSelectedPageId(pages[currentIdx - 1].id);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const currentIdx = selectedRegionId
          ? regions.findIndex((r) => r.id === selectedRegionId)
          : -1;
        const nextIdx = e.key === "ArrowDown"
          ? Math.min(currentIdx + 1, regions.length - 1)
          : Math.max(currentIdx - 1, 0);
        if (nextIdx >= 0) setSelectedRegionId(regions[nextIdx].id);
      } else if (e.key === "Enter" && selectedPageId && !busy) {
        if (e.ctrlKey) {
          runBatchTranslate();
        } else {
          runOcr(selectedPageId);
        }
      } else if (e.key === "r" && selectedPageId && regions.length > 0) {
        reviewAllRegions();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pages, selectedPageId, regions, selectedRegionId, busy]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy("upload");
    setError(null);
    const toastId = toast.loading(`📤 ${files.length}개 파일 업로드 중...`);
    try {
      const formData = new FormData();
      formData.append("projectId", projectId);
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetch("/api/pages", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error);
      await loadProject();
      toast.success("✅ 파일 업로드 완료!", { id: toastId, description: "OCR을 실행해주세요" });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("파일 업로드 실패", { id: toastId, description: msg });
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function runOcr(pageId: string) {
    setBusy("ocr");
    setError(null);
    const toastId = toast.loading("🔍 OCR 실행 중... (0%)");
    try {
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);

      // Job 진행 상황 폴링
      let completed = false;
      let maxProgress = 0;
      while (!completed) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 0.5초마다 확인

        const jobsRes = await fetch("/api/jobs?filter=running");
        if (jobsRes.ok) {
          const { jobs } = await jobsRes.json();
          const ocrJob = jobs.find((j: Job) => j.type === "ocr" && j.page_id === pageId);

          if (ocrJob) {
            maxProgress = Math.max(maxProgress, ocrJob.progress);
            toast.loading(`🔍 OCR 실행 중... (${maxProgress}%)`, { id: toastId });
          } else {
            completed = true;
          }
        }
      }

      await loadPageDetail(pageId);
      toast.success("✅ OCR 완료!", { id: toastId, description: "텍스트가 인식되었습니다" });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("OCR 실패", { id: toastId, description: msg });
    } finally {
      setBusy(null);
    }
  }

  async function runBatchOcr() {
    setBusy("batch-ocr");
    setError(null);
    const toastId = toast.loading(`🔍 ${pages.length}개 페이지 OCR 중... (0%)`);

    try {
      const res = await fetch("/api/pages/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ocr",
          pageIds: pages.map((p) => p.id),
          projectId,
        }),
      });
      if (!res.ok) throw new Error("일괄 OCR 실패");

      // Job 진행 상황 폴링
      let allCompleted = false;
      let maxProgress = 0;
      while (!allCompleted) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1초마다 확인

        const jobsRes = await fetch("/api/jobs?filter=running");
        if (jobsRes.ok) {
          const { jobs } = await jobsRes.json();
          const ocrJobs = jobs.filter((j: Job) => j.type === "ocr" && j.project_id === projectId);

          if (ocrJobs.length > 0) {
            const avgProgress = Math.round(ocrJobs.reduce((sum: number, j: Job) => sum + j.progress, 0) / ocrJobs.length);
            maxProgress = Math.max(maxProgress, avgProgress);
            toast.loading(`🔍 ${pages.length}개 페이지 OCR 중... (${maxProgress}%)`, { id: toastId });
          } else {
            allCompleted = true;
          }
        }
      }

      await loadProject();
      if (selectedPageId) await loadPageDetail(selectedPageId);
      toast.success("✅ 일괄 OCR 완료!", { id: toastId, description: `${pages.length}개 페이지가 OCR 처리되었습니다` });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("일괄 OCR 실패", { id: toastId, description: msg });
    } finally {
      setBusy(null);
    }
  }

  async function runBatchTranslate(pageIdsToTranslate?: string[]) {
    const idsToUse = pageIdsToTranslate || Array.from(selectedPageIds);
    if (idsToUse.length === 0) {
      toast.info("페이지를 선택해주세요");
      return;
    }
    setBusy("batch-translate");
    setError(null);
    const toastId = toast.loading(`🌐 ${idsToUse.length}개 페이지 번역 중... (0%)`);
    try {
      const res = await fetch("/api/pages/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "translate",
          pageIds: idsToUse,
          projectId,
        }),
      });
      if (!res.ok) throw new Error("일괄 번역 실패");

      // Job 진행 상황 폴링
      let allCompleted = false;
      let maxProgress = 0;
      while (!allCompleted) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1초마다 확인

        const jobsRes = await fetch("/api/jobs?filter=running");
        if (jobsRes.ok) {
          const { jobs } = await jobsRes.json();
          const translateJobs = jobs.filter((j: Job) => j.type === "translate" && j.project_id === projectId);

          if (translateJobs.length > 0) {
            const avgProgress = Math.round(translateJobs.reduce((sum: number, j: Job) => sum + j.progress, 0) / translateJobs.length);
            maxProgress = Math.max(maxProgress, avgProgress);
            toast.loading(`🌐 ${idsToUse.length}개 페이지 번역 중... (${maxProgress}%)`, { id: toastId });
          } else {
            allCompleted = true;
          }
        }
      }

      await loadProject();
      if (selectedPageId) await loadPageDetail(selectedPageId);
      toast.success("✅ 일괄 번역 완료!", { id: toastId, description: `${idsToUse.length}개 페이지가 번역되었습니다` });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("일괄 번역 실패", { id: toastId, description: msg });
    } finally {
      setBusy(null);
    }
  }

  async function clearOcr(pageId: string) {
    if (!confirm("이 페이지의 OCR 결과를 초기화하시겠습니까?")) return;

    setBusy("clear-ocr");
    setError(null);
    const toastId = toast.loading("🗑️ OCR 초기화 중...");
    try {
      const res = await fetch("/api/regions/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) throw new Error("OCR 초기화 실패");

      // 즉시 UI 업데이트
      setRegions([]);

      // 페이지 정보 새로고침
      await loadProject();
      await loadPageDetail(pageId);

      toast.success("✅ OCR 초기화 완료!", { id: toastId, description: "OCR을 다시 실행해주세요" });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("OCR 초기화 실패", { id: toastId, description: msg });
    } finally {
      setBusy(null);
    }
  }

  async function clearAllOcr() {
    if (!confirm("정말 모든 페이지의 OCR 결과를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.")) return;

    setBusy("clear-all-ocr");
    setError(null);
    const toastId = toast.loading("🗑️ 전체 OCR 초기화 중...");
    try {
      const res = await fetch("/api/regions/clear-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("전체 OCR 초기화 실패");

      const data = await res.json();

      // 즉시 UI 업데이트
      setRegions([]);

      // 전체 프로젝트 새로고침
      await loadProject();
      if (selectedPageId) await loadPageDetail(selectedPageId);

      toast.success("✅ 전체 OCR 초기화 완료!", { id: toastId, description: `${data.pagesCleared}개 페이지 초기화됨` });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("전체 OCR 초기화 실패", { id: toastId, description: msg });
    } finally {
      setBusy(null);
    }
  }

  async function rerunOcrForRegion(regionId: string) {
    if (!selectedPageId) return;
    setBusy(`ocr-${regionId}`);
    setError(null);
    const toastId = toast.loading("🔄 영역 OCR 재실행 중...");
    try {
      const res = await fetch(`/api/regions/${regionId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: selectedPageId }),
      });
      if (!res.ok) throw new Error("OCR 재실행 실패");
      await loadPageDetail(selectedPageId);
      toast.success("✅ OCR 재실행 완료!", { id: toastId });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("OCR 재실행 실패", { id: toastId, description: msg });
    } finally {
      setBusy(null);
    }
  }

  async function rerunTranslateForRegion(regionId: string) {
    if (!selectedPageId) return;
    setBusy(`translate-${regionId}`);
    setError(null);
    const toastId = toast.loading("🔄 영역 번역 재실행 중...");
    try {
      const res = await fetch(`/api/regions/${regionId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: selectedPageId }),
      });
      if (!res.ok) throw new Error("번역 재실행 실패");
      await loadPageDetail(selectedPageId);
      toast.success("✅ 번역 재실행 완료!", { id: toastId });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("번역 재실행 실패", { id: toastId, description: msg });
    } finally {
      setBusy(null);
    }
  }

  function updateRegionText(
    regionId: string,
    field: "source_text" | "translated_text",
    text: string
  ) {
    setRegions((prev) =>
      prev.map((r) => (r.id === regionId ? { ...r, [field]: text } : r))
    );

    if (saveTimeoutsRef.current[regionId]) {
      clearTimeout(saveTimeoutsRef.current[regionId]);
    }

    setSavingRegions((prev) => new Set([...prev, regionId]));

    saveTimeoutsRef.current[regionId] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/regions/${regionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: text }),
        });
        if (!res.ok) throw new Error("저장 실패");
        setSavingRegions((prev) => {
          const next = new Set(prev);
          next.delete(regionId);
          return next;
        });
      } catch (e) {
        setError((e as Error).message);
        setSavingRegions((prev) => {
          const next = new Set(prev);
          next.delete(regionId);
          return next;
        });
      }
    }, 300);
  }

  async function reviewAllRegions() {
    for (const region of regions) {
      await fetch(`/api/regions/${region.id}/review`, { method: "POST" });
    }
    await loadPageDetail(selectedPageId!);
  }

  const selectedPage = pages.find((p) => p.id === selectedPageId) ?? null;
  const selectedRegion = regions.find((r) => r.id === selectedRegionId);
  const progress = selectedPage && regions ? getProgressPercent(selectedPage, regions) : 0;
  const selectedCount = selectedPageIds.size;

  // 영역 박스 수정 상태 관리
  const [draggingRegionId, setDraggingRegionId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<"move" | "resize-se" | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // 내보내기 및 폰트 설정
  const [exportFormat, setExportFormat] = useState<"zip" | "pdf">("zip");
  const [selectedFont, setSelectedFont] = useState("serif");
  const [textBackgroundOpacity, setTextBackgroundOpacity] = useState(0.8);
  const [availableFonts, setAvailableFonts] = useState<Array<{ id: string; name: string; preview: string }>>([]);

  return (
    <div className={darkMode ? "dark bg-zinc-900" : ""}>
      <div className={darkMode ? "bg-zinc-800 text-white" : ""}>
        {/* 헤더 */}
        <header className="border-b border-gray-200 bg-white/80 backdrop-blur sticky top-0 z-40">
          <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
            <div>
              <button
                onClick={() => router.push("/")}
                className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-pink)] mb-2 flex items-center gap-1 transition-colors"
              >
                ← 프로젝트 목록
              </button>
              <h1 className="font-display text-2xl font-extrabold text-[var(--color-ink)]">
                {project?.name ?? "로딩 중..."} {selectedPageId && selectedPage && `(${pages.findIndex(p => p.id === selectedPageId) + 1}/${pages.length})`}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {progress > 0 && <div className="text-sm font-medium">진행률: {progress}%</div>}
              <button
                onClick={() => setShowSettings(true)}
                className="px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-bold hover:bg-blue-600 transition-colors"
                title="프로젝트 설정"
              >
                ⚙️ 설정
              </button>
              <button onClick={() => setDarkMode(!darkMode)} className="text-2xl">
                {darkMode ? "☀️" : "🌙"}
              </button>
              <button
                onClick={handleDeleteProject}
                className="px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors"
              >
                삭제 ❌
              </button>
            </div>
          </div>
          {/* 진행 중인 작업 표시 */}
          {hasRunningJobs && (
            <div className="h-1 bg-yellow-200">
              <div className="h-full bg-gradient-to-r from-yellow-400 to-orange-400 animate-pulse" />
            </div>
          )}

          {progress > 0 && (
            <div className="h-1 bg-gray-200">
              <div
                className="h-full bg-gradient-to-r from-[var(--color-pink)] to-[var(--color-mint)] transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </header>

        <main
          className="mx-auto max-w-7xl px-6 py-8"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length > 0) {
              handleUploadFiles(e.dataTransfer.files);
            }
          }}
        >
          {dragging && (
            <div className="fixed inset-0 bg-blue-500/20 border-4 border-dashed border-blue-500 rounded-lg z-40 flex items-center justify-center">
              <div className="text-3xl font-bold text-blue-600">📥 여기에 드롭하세요</div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm">
              ❌ {error}
            </div>
          )}

          {/* 파일 업로드 */}
          {!selectedPageId && (
            <div className="mb-6 p-6 rounded-2xl border-2 border-dashed border-[var(--color-pink-light)] bg-[var(--color-pink-light)]/20 text-center">
              <label className="cursor-pointer">
                <div className="text-3xl mb-2">📤</div>
                <div className="font-medium text-[var(--color-ink)]">이미지 · PDF · ZIP 선택</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.zip"
                  onChange={(e) => handleUpload(e.currentTarget.files)}
                  className="hidden"
                />
              </label>
            </div>
          )}

          {selectedPageId && selectedPage && (
            <div className="relative">
              {/* 왼쪽 슬라이드 패널 - 파일 목록 */}
              <aside className={`fixed left-0 top-20 h-[calc(100vh-100px)] w-80 bg-white shadow-2xl transform transition-transform duration-300 z-40 ${showLeftSidebar ? 'translate-x-0' : '-translate-x-full'} overflow-y-auto`}>
                <div className="sticky top-0 bg-white pb-4">
                  {/* 진행 중인 작업 표시 */}
                  {hasRunningJobs && (
                    <div className="mb-3 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                      <div className="text-xs font-bold text-yellow-700 mb-2">⚙️ 작업 진행 중...</div>
                      {runningJobs.map((job) => (
                        <div key={job.id} className="mb-2 last:mb-0">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-medium">
                              {job.type === 'ocr' ? '🔍 OCR' : '🌐 번역'}: {job.progress}%
                            </span>
                            <button
                              onClick={() => cancelJob(job.id)}
                              className="text-red-600 hover:text-red-700 font-bold"
                              title="작업 취소"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-gradient-to-r from-yellow-400 to-orange-400 h-2 rounded-full transition-all"
                              style={{ width: `${job.progress}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <h3 className="font-bold text-sm mb-3">📁 파일 ({pages.length})</h3>

                  {/* 전체 OCR 버튼 */}
                  <button
                    onClick={runBatchOcr}
                    disabled={busy?.startsWith("batch-")}
                    className="w-full mb-2 px-3 py-2 rounded-lg bg-[var(--color-mint)] text-white text-xs font-bold hover:bg-opacity-90 transition-all disabled:opacity-50"
                  >
                    {busy === "batch-ocr" ? "🔍 OCR 중..." : "🔍 전체 OCR"}
                  </button>

                  {/* 전체 번역 버튼 */}
                  <button
                    onClick={() => runBatchTranslate(pages.map((p) => p.id))}
                    disabled={busy?.startsWith("batch-")}
                    className="w-full mb-3 px-3 py-2 rounded-lg bg-[var(--color-pink)] text-white text-xs font-bold hover:bg-opacity-90 transition-all disabled:opacity-50"
                  >
                    {busy === "batch-translate" ? "🌐 번역 중..." : "🌐 전체 번역"}
                  </button>

                  {/* 전체 OCR 초기화 버튼 */}
                  <button
                    onClick={clearAllOcr}
                    disabled={busy?.startsWith("clear-") || pages.length === 0}
                    className="w-full mb-3 px-3 py-2 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-all disabled:opacity-50"
                    title="모든 페이지의 OCR 결과를 삭제하고 초기화합니다"
                  >
                    {busy === "clear-all-ocr" ? "🗑️ 초기화 중..." : "🗑️ 전체 OCR 초기화"}
                  </button>

                  {/* 일괄 선택 버튼 */}
                  {selectedCount > 0 && (
                    <div className="mb-3 p-3 rounded-lg bg-[var(--color-pink-light)] space-y-2">
                      <div className="text-xs font-bold text-[var(--color-ink)]">
                        ✅ {selectedCount}개 선택
                      </div>
                      <button
                        onClick={runBatchTranslate}
                        disabled={busy?.startsWith("batch-")}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--color-pink)] text-white text-xs font-bold hover:bg-opacity-90 transition-all disabled:opacity-50"
                      >
                        {busy === "batch-translate" ? "번역 중..." : "일괄 번역 🚀"}
                      </button>
                    </div>
                  )}

                  {/* 파일 목록 */}
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {pages.map((page, idx) => (
                      <div key={page.id} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selectedPageIds.has(page.id)}
                          onChange={(e) => {
                            const newSet = new Set(selectedPageIds);
                            if (e.target.checked) newSet.add(page.id);
                            else newSet.delete(page.id);
                            setSelectedPageIds(newSet);
                          }}
                          className="mt-1 cursor-pointer"
                        />
                        <button
                          onClick={() => setSelectedPageId(page.id)}
                          className={`flex-1 text-left px-3 py-2 rounded-lg text-xs border-2 transition-all ${
                            selectedPageId === page.id
                              ? "border-[var(--color-pink)] bg-[var(--color-pink-light)]"
                              : "border-gray-200 bg-gray-50 hover:border-[var(--color-pink)]/50"
                          }`}
                        >
                          <div className="font-bold">#{idx + 1}</div>
                          <div className="text-[var(--color-ink-soft)]">{STATUS_META[page.status]?.emoji} {STATUS_META[page.status]?.label}</div>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>

              {/* 중앙: 이미지 + OCR 박스 (전체 너비) */}
              <div className="relative">
                {/* 상단 컨트롤바 */}
                <div className="flex gap-2 mb-4 items-center">
                  <button
                    onClick={() => setShowLeftSidebar(!showLeftSidebar)}
                    className="px-3 py-2 rounded-lg bg-blue-500 text-white text-xs font-bold hover:bg-blue-600 transition-colors"
                  >
                    📁 파일 {showLeftSidebar ? "🔒" : ""}
                  </button>

                  {/* 미리보기 모드 토글 */}
                  <div className="flex gap-2 flex-1">
                    <button
                      onClick={() => setPreviewMode(false)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                        !previewMode
                          ? "bg-[var(--color-mint)] text-white"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      🔍 OCR 편집
                    </button>
                    <button
                      onClick={() => setPreviewMode(true)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                        previewMode
                          ? "bg-[var(--color-pink)] text-white"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      👁️ 번역 미리보기
                    </button>
                  </div>

                  <button
                    onClick={() => clearOcr(selectedPageId!)}
                    disabled={!selectedPageId || regions.length === 0}
                    className="px-3 py-2 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="현재 페이지의 OCR 결과를 삭제하고 초기화합니다"
                  >
                    🗑️ OCR 초기화
                  </button>

                  <button
                    onClick={() => setShowRightSidebar(!showRightSidebar)}
                    className="px-3 py-2 rounded-lg bg-pink-500 text-white text-xs font-bold hover:bg-pink-600 transition-colors"
                  >
                    ✏️ 편집 {showRightSidebar ? "🔒" : ""}
                  </button>
                </div>

                {/* 이미지 미리보기 */}
                <div className="bg-gray-100 rounded-2xl overflow-hidden border-2 border-gray-200 relative flex items-center justify-center"
                     style={{ height: "calc(100vh - 200px)" }}>
                  <img
                    src={`/api/pages/${selectedPageId}/image`}
                    alt="Page"
                    className="w-full h-full object-contain"
                    style={{ opacity: previewMode ? 0.4 : 1 }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      const realWidth = img.naturalWidth;
                      const realHeight = img.naturalHeight;
                      if (realWidth > 0 && realHeight > 0) {
                        setImageDimensions({ w: realWidth, h: realHeight });
                        console.log(`✅ 이미지 실제 크기: ${realWidth}x${realHeight}`);
                      }
                    }}
                  />

                  {/* OCR 박스 오버레이 또는 번역 미리보기 */}
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox={`0 0 ${imageDimensions.w} ${imageDimensions.h}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ cursor: isDrawingBox ? "crosshair" : "pointer", display: previewMode ? "none" : "block" }}
                    onMouseDown={(e) => {
                      if (e.button !== 0 || editingRegionId) return; // 좌측 마우스 버튼만, 수정 중이 아닐 때만

                      const svg = e.currentTarget;
                      const rect = svg.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const y = e.clientY - rect.top;

                      const scaleX = imageDimensions.w / rect.width;
                      const scaleY = imageDimensions.h / rect.height;

                      setIsDrawingBox(true);
                      setDrawingStart({ x: x * scaleX, y: y * scaleY });
                      setDrawingEnd({ x: x * scaleX, y: y * scaleY });
                    }}
                    onMouseMove={(e) => {
                      if (isDrawingBox && drawingStart) {
                        // 새 영역 드래그 중
                        const svg = e.currentTarget;
                        const rect = svg.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;

                        const scaleX = imageDimensions.w / rect.width;
                        const scaleY = imageDimensions.h / rect.height;

                        setDrawingEnd({ x: x * scaleX, y: y * scaleY });
                        return;
                      }

                      if (!dragStart || !editingRegionId) return;

                      const svg = e.currentTarget;
                      const rect = svg.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const y = e.clientY - rect.top;

                      const scaleX = imageDimensions.w / rect.width;
                      const scaleY = imageDimensions.h / rect.height;

                      const currentX = x * scaleX;
                      const currentY = y * scaleY;

                      const deltaX = currentX - dragStart.x;
                      const deltaY = currentY - dragStart.y;

                      setDragOffset({ x: deltaX, y: deltaY });
                    }}
                    onMouseUp={(e) => {
                      if (isDrawingBox && drawingStart && drawingEnd) {
                        // 새 영역 생성
                        const x1 = Math.min(drawingStart.x, drawingEnd.x);
                        const y1 = Math.min(drawingStart.y, drawingEnd.y);
                        const x2 = Math.max(drawingStart.x, drawingEnd.x);
                        const y2 = Math.max(drawingStart.y, drawingEnd.y);

                        const width = x2 - x1;
                        const height = y2 - y1;

                        // 최소 크기 체크
                        if (width > 10 && height > 10 && selectedPageId) {
                          const newRegion = {
                            id: Math.random().toString(36),
                            page_id: selectedPageId,
                            x: Math.round(x1),
                            y: Math.round(y1),
                            width: Math.round(width),
                            height: Math.round(height),
                            source_text: "",
                            translated_text: "",
                            confidence: 0
                          };

                          setRegions([...regions, newRegion]);
                          toast.success("새 영역이 생성되었습니다!");
                        }

                        setIsDrawingBox(false);
                        setDrawingStart(null);
                        setDrawingEnd(null);
                        return;
                      }

                      if (!dragStart || !editingRegionId || !selectedRegion) return;

                      const svg = e.currentTarget;
                      const rect = svg.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const y = e.clientY - rect.top;

                      const scaleX = imageDimensions.w / rect.width;
                      const scaleY = imageDimensions.h / rect.height;

                      const currentX = x * scaleX;
                      const currentY = y * scaleY;

                      const deltaX = currentX - dragStart.x;
                      const deltaY = currentY - dragStart.y;

                      // 코너별 리사이즈 처리
                      if (editingRegionId.includes("-resize")) {
                        const dir = editingRegionId.split("-").pop();
                        let newX = selectedRegion.x;
                        let newY = selectedRegion.y;
                        let newWidth = selectedRegion.width;
                        let newHeight = selectedRegion.height;

                        if (dir === "nw") {
                          // 좌상단: x↑, y↑, w↓, h↓
                          newX = Math.min(selectedRegion.x + deltaX, selectedRegion.x + selectedRegion.width - 20);
                          newY = Math.min(selectedRegion.y + deltaY, selectedRegion.y + selectedRegion.height - 20);
                          newWidth = Math.max(20, selectedRegion.width - deltaX);
                          newHeight = Math.max(20, selectedRegion.height - deltaY);
                        } else if (dir === "ne") {
                          // 우상단: w↑, y↑, h↓
                          newY = Math.min(selectedRegion.y + deltaY, selectedRegion.y + selectedRegion.height - 20);
                          newWidth = Math.max(20, selectedRegion.width + deltaX);
                          newHeight = Math.max(20, selectedRegion.height - deltaY);
                        } else if (dir === "sw") {
                          // 좌하단: x↑, w↓, h↑
                          newX = Math.min(selectedRegion.x + deltaX, selectedRegion.x + selectedRegion.width - 20);
                          newWidth = Math.max(20, selectedRegion.width - deltaX);
                          newHeight = Math.max(20, selectedRegion.height + deltaY);
                        } else if (dir === "se") {
                          // 우하단: w↑, h↑
                          newWidth = Math.max(20, selectedRegion.width + deltaX);
                          newHeight = Math.max(20, selectedRegion.height + deltaY);
                        }

                        setRegions(regions.map(r =>
                          r.id === selectedRegion.id
                            ? { ...r, x: newX, y: newY, width: newWidth, height: newHeight }
                            : r
                        ));

                        fetch(`/api/regions/${selectedRegion.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            x: newX,
                            y: newY,
                            width: newWidth,
                            height: newHeight
                          }),
                        }).catch(console.error);
                      } else {
                        // 이동 저장
                        const newX = selectedRegion.x + deltaX;
                        const newY = selectedRegion.y + deltaY;

                        setRegions(regions.map(r =>
                          r.id === selectedRegion.id
                            ? { ...r, x: newX, y: newY }
                            : r
                        ));

                        fetch(`/api/regions/${selectedRegion.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            x: newX,
                            y: newY
                          }),
                        }).catch(console.error);
                      }

                      setEditingRegionId(null);
                      setDragStart(null);
                      setDragOffset({ x: 0, y: 0 });
                    }}
                  >
                    {regions.map((region, idx) => {
                      // viewBox 사용으로 원본 좌표 그대로 사용
                      const x = region.x;
                      const y = region.y;
                      const w = region.width;
                      const h = region.height;

                      const isSelected = region.id === selectedRegionId;
                      const hasTranslation = !!region.translated_text;

                      if (previewMode) {
                        // 번역 미리보기 모드: 번역 텍스트를 배경과 함께 표시
                        return (
                          <g key={region.id} onClick={() => setSelectedRegionId(region.id)}>
                            {/* 반투명 배경 */}
                            <rect
                              x={x}
                              y={y}
                              width={w}
                              height={h}
                              fill={isSelected ? "#ff69b4" : "#ffffff"}
                              opacity={isSelected ? 0.3 : 0.15}
                              stroke={isSelected ? "#ff69b4" : "#ffffff"}
                              strokeWidth="1"
                              style={{ cursor: "pointer" }}
                            />
                            {/* 번역 텍스트 */}
                            {hasTranslation && (
                              <>
                                <text
                                  x={x + w / 2}
                                  y={y + h / 2 - 5}
                                  textAnchor="middle"
                                  fill="#000000"
                                  fontSize={Math.max(12, Math.min(h / 3, 18))}
                                  fontWeight="bold"
                                  style={{
                                    pointerEvents: "none",
                                    textShadow: "0 0 3px white",
                                    paintOrder: "stroke",
                                    stroke: "white",
                                    strokeWidth: 3,
                                  }}
                                >
                                  {region.translated_text.substring(0, 20)}
                                  {region.translated_text.length > 20 ? "..." : ""}
                                </text>
                              </>
                            )}
                          </g>
                        );
                      } else {
                        // OCR 편집 모드: 박스와 번호 표시
                        const isEditing = editingRegionId === region.id;
                        const displayX = isEditing ? x + dragOffset.x : x;
                        const displayY = isEditing ? y + dragOffset.y : y;
                        const displayW = isEditing ? Math.max(30, w + dragOffset.x) : w;
                        const displayH = isEditing ? Math.max(30, h + dragOffset.y) : h;

                        return (
                          <g key={region.id}>
                            {/* 선택된 영역이면 반투명 배경 표시 */}
                            {isSelected && (
                              <rect
                                x={displayX - 3}
                                y={displayY - 3}
                                width={displayW + 6}
                                height={displayH + 6}
                                fill="#ff69b4"
                                opacity="0.1"
                              />
                            )}

                            {/* 메인 박스 */}
                            <rect
                              x={displayX}
                              y={displayY}
                              width={displayW}
                              height={displayH}
                              fill={isSelected ? "rgba(255, 105, 180, 0.05)" : "none"}
                              stroke={isSelected ? "#ff69b4" : hasTranslation ? "#7dd3c0" : "#ffd6a5"}
                              strokeWidth={isSelected ? "3" : "2"}
                              strokeDasharray={isSelected ? "0" : "5"}
                              onClick={() => setSelectedRegionId(region.id)}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                if (isSelected) {
                                  const svg = (e.currentTarget.ownerSVGElement || e.currentTarget.closest('svg')) as SVGSVGElement;
                                  if (svg) {
                                    const rect = svg.getBoundingClientRect();
                                    const x = e.clientX - rect.left;
                                    const y = e.clientY - rect.top;
                                    const scaleX = imageDimensions.w / rect.width;
                                    const scaleY = imageDimensions.h / rect.height;
                                    setEditingRegionId(region.id);
                                    setDragStart({
                                      x: x * scaleX,
                                      y: y * scaleY
                                    });
                                  }
                                }
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.opacity = "1";
                                  e.currentTarget.style.strokeWidth = "2.5";
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.opacity = "0.7";
                                  e.currentTarget.style.strokeWidth = "2";
                                }
                              }}
                              style={{
                                opacity: isSelected ? 1 : 0.7,
                                cursor: isSelected ? "move" : "pointer",
                                transition: "all 0.1s ease"
                              }}
                            />

                            {/* 리사이즈 핸들 - 4개 코너 */}
                            {isSelected && [
                              { cx: displayX, cy: displayY, cursor: "nw-resize", dir: "nw" },
                              { cx: displayX + displayW, cy: displayY, cursor: "ne-resize", dir: "ne" },
                              { cx: displayX, cy: displayY + displayH, cursor: "sw-resize", dir: "sw" },
                              { cx: displayX + displayW, cy: displayY + displayH, cursor: "se-resize", dir: "se" }
                            ].map((handle) => (
                              <rect
                                key={handle.dir}
                                x={handle.cx - 10}
                                y={handle.cy - 10}
                                width="20"
                                height="20"
                                fill="#ff69b4"
                                opacity="0.6"
                                rx="3"
                                style={{ cursor: handle.cursor }}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  setEditingRegionId(region.id + "-" + handle.dir);
                                  setDragStart({
                                    x: e.clientX,
                                    y: e.clientY
                                  });
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.opacity = "1";
                                  e.currentTarget.style.fill = "#ff1493";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.opacity = "0.6";
                                  e.currentTarget.style.fill = "#ff69b4";
                                }}
                              />
                            ))}

                            {/* 번호 표시 */}
                            {isSelected && (
                              <text
                                x={displayX + 5}
                                y={displayY - 5}
                                fill="#ff69b4"
                                fontSize="14"
                                fontWeight="bold"
                                style={{ pointerEvents: "none" }}
                              >
                                #{idx + 1}
                              </text>
                            )}

                            {/* 삭제 버튼 (X) */}
                            {isSelected && (
                              <g
                                onClick={() => {
                                  setRegions(regions.filter(r => r.id !== region.id));
                                  fetch(`/api/regions/${region.id}`, { method: "DELETE" }).catch(console.error);
                                  setSelectedRegionId(null);
                                }}
                                style={{ cursor: "pointer" }}
                              >
                                <circle cx={displayX + displayW + 15} cy={displayY - 15} r="12" fill="#ff3333" opacity="0.8" />
                                <text x={displayX + displayW + 15} y={displayY - 10} textAnchor="middle" fill="white" fontSize="16" fontWeight="bold" style={{ pointerEvents: "none" }}>×</text>
                              </g>
                            )}
                          </g>
                        );
                      }
                    })}

                    {/* 드래그 중인 새 박스 표시 */}
                    {isDrawingBox && drawingStart && drawingEnd && (
                      <rect
                        x={Math.min(drawingStart.x, drawingEnd.x)}
                        y={Math.min(drawingStart.y, drawingEnd.y)}
                        width={Math.abs(drawingEnd.x - drawingStart.x)}
                        height={Math.abs(drawingEnd.y - drawingStart.y)}
                        fill="#ffeb3b"
                        opacity="0.3"
                        stroke="#fbc02d"
                        strokeWidth="2"
                        strokeDasharray="5,5"
                      />
                    )}
                  </svg>
                </div>

                {/* 파일 정보 */}
                <div className="text-xs text-gray-500">
                  {selectedPage?.filename} · {regions.length}개 영역 · 신뢰도 평균:{" "}
                  {regions.length > 0
                    ? (regions.reduce((sum, r) => sum + r.confidence, 0) / regions.length * 100).toFixed(0)
                    : 0}
                  %
                </div>

                {/* 영역 상세 편집 */}
                {selectedRegion && (
                  <div className="bg-gradient-to-br from-[var(--color-pink-light)] to-[var(--color-mint-light)] rounded-2xl border-2 border-[var(--color-pink)] p-5 space-y-4 shadow-lg">
                    <h3 className="font-bold text-sm">✏️ 영역 #{regions.indexOf(selectedRegion) + 1} 편집</h3>

                    {/* 원문 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-2 font-medium">원문</label>
                      <textarea
                        value={selectedRegion.source_text}
                        onChange={(e) =>
                          updateRegionText(selectedRegion.id, "source_text", e.target.value)
                        }
                        className="w-full border-2 border-[var(--color-butter-light)] focus:border-[var(--color-butter)] outline-none rounded-lg px-3 py-2 text-sm resize-none"
                        rows={2}
                        style={{ opacity: savingRegions.has(selectedRegion.id) ? 0.6 : 1 }}
                      />
                      {savingRegions.has(selectedRegion.id) && (
                        <div className="text-xs text-gray-500 mt-1">💾 저장 중...</div>
                      )}
                      <button
                        onClick={() => rerunOcrForRegion(selectedRegion.id)}
                        disabled={busy?.startsWith("ocr-")}
                        className="mt-2 w-full px-3 py-2 rounded-lg bg-[var(--color-butter-light)] hover:bg-[var(--color-butter)] text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {busy === `ocr-${selectedRegion.id}` ? "🔄 OCR 실행 중..." : "🔄 OCR 다시 실행"}
                      </button>
                    </div>

                    {/* 번역문 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-2 font-medium">번역문</label>
                      <textarea
                        value={selectedRegion.translated_text}
                        onChange={(e) =>
                          updateRegionText(selectedRegion.id, "translated_text", e.target.value)
                        }
                        className="w-full border-2 border-[var(--color-mint-light)] focus:border-[var(--color-mint)] outline-none rounded-lg px-3 py-2 text-sm resize-none"
                        rows={2}
                        style={{ opacity: savingRegions.has(selectedRegion.id) ? 0.6 : 1 }}
                      />
                      {savingRegions.has(selectedRegion.id) && (
                        <div className="text-xs text-gray-500 mt-1">💾 저장 중...</div>
                      )}
                      <button
                        onClick={() => rerunTranslateForRegion(selectedRegion.id)}
                        disabled={busy?.startsWith("translate-") || !selectedRegion.source_text}
                        className="mt-2 w-full px-3 py-2 rounded-lg bg-[var(--color-mint-light)] hover:bg-[var(--color-mint)] text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {busy === `translate-${selectedRegion.id}` ? "🌐 번역 중..." : "🌐 번역 다시 실행"}
                      </button>
                    </div>

                    {/* 영역 수정 안내 */}
                    <div className="pt-2 border-t border-gray-200">
                      <div className="text-xs text-[var(--color-mint)] bg-[var(--color-mint-light)] rounded-lg p-3">
                        📍 <strong>이미지에서 영역을 드래그해서 수정하세요</strong>
                        <ul className="mt-2 space-y-1 text-[0.7rem]">
                          <li>🖱️ 박스를 드래그해서 위치 이동</li>
                          <li>📐 우측 하단 핸들로 크기 조정</li>
                          <li>❌ 빨간 X 버튼으로 삭제</li>
                        </ul>
                      </div>
                    </div>

                    {/* 신뢰도 */}
                    <div className="pt-2 border-t border-gray-200">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">신뢰도</span>
                        <span className={`px-2 py-1 rounded font-medium ${confidenceBadge(selectedRegion.confidence)}`}>
                          {(selectedRegion.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 우측: 번역 카드 (슬라이드 패널) */}
              <div className={`fixed right-0 top-20 h-[calc(100vh-100px)] w-96 bg-white shadow-2xl transform transition-transform duration-300 z-40 ${showRightSidebar ? 'translate-x-0' : 'translate-x-full'} overflow-y-auto p-4`}>
                <div className="space-y-3">
                  {/* 모드 토글 */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCompareMode(!compareMode)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                        compareMode
                          ? "bg-[var(--color-pink)] text-white"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {compareMode ? "➡️ 비교" : "⬅️ 카드"}
                    </button>
                  </div>

                  {/* 번역 목록 */}
                  <div className="bg-white rounded-2xl border-2 border-gray-200 p-3 max-h-96 overflow-y-auto space-y-2">
                    {regions.length === 0 ? (
                      <div className="text-xs text-gray-500 text-center py-6">OCR 실행 후 번역을 해주세요</div>
                    ) : compareMode ? (
                      // 비교 모드
                      regions.map((r, idx) => (
                        <div
                          key={r.id}
                          onClick={() => setSelectedRegionId(r.id)}
                          className={`border-2 rounded-lg p-2.5 text-xs cursor-pointer transition-colors ${
                            selectedRegionId === r.id
                              ? "border-[var(--color-pink)] bg-[var(--color-pink-light)]"
                              : "border-gray-200 bg-gray-50 hover:border-[var(--color-pink)]/50"
                          }`}
                        >
                          <div className="font-bold mb-1">#{idx + 1}</div>
                          <div className="mb-2 p-1.5 bg-white rounded border border-gray-200">
                            <div className="text-[0.65rem] text-gray-500 mb-0.5">원문</div>
                            <div className="font-medium truncate">{r.source_text}</div>
                          </div>
                          <div className="p-1.5 bg-white rounded border border-gray-200">
                            <div className="text-[0.65rem] text-gray-500 mb-0.5">번역</div>
                            <div className="font-medium truncate text-[var(--color-mint)]">{r.translated_text || "(미번역)"}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      // 카드 모드
                      regions.map((r, idx) => (
                        <div
                          key={r.id}
                          onClick={() => setSelectedRegionId(r.id)}
                          className={`border-2 rounded-lg p-2.5 text-xs cursor-pointer transition-colors ${
                            selectedRegionId === r.id
                              ? "border-[var(--color-pink)] bg-[var(--color-pink-light)]"
                              : "border-gray-200 bg-gray-50 hover:border-[var(--color-pink)]/50"
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1.5">
                            <span className="font-bold">#{idx + 1}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[0.65rem] font-medium ${confidenceBadge(r.confidence)}`}>
                              {(r.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="text-gray-700 mb-1.5 line-clamp-2">{r.source_text}</div>
                          <div className="text-[var(--color-mint)] font-medium line-clamp-2">
                            {r.translated_text || "○ 대기중"}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* 프로젝트 설정 모달 */}
        {showSettings && project && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-md p-8 animate-in fade-in zoom-in-95">
              <h2 className="text-2xl font-display font-bold text-[var(--color-ink)] mb-6">
                ⚙️ 프로젝트 설정
              </h2>

              <div className="space-y-4">
                {/* 프로젝트 이름 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-2 font-medium">프로젝트 이름</label>
                  <input
                    type="text"
                    defaultValue={project.name}
                    id="settings-name"
                    className="w-full border-2 border-[var(--color-lavender-light)] focus:border-[var(--color-lavender)] outline-none rounded-lg px-3 py-2.5 transition-colors"
                  />
                </div>

                {/* 원문 언어 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-2 font-medium">원문 언어</label>
                  <select
                    defaultValue={project.source_lang}
                    id="settings-source-lang"
                    className="w-full border-2 border-[var(--color-mint-light)] focus:border-[var(--color-mint)] outline-none rounded-lg px-3 py-2.5 bg-white transition-colors"
                  >
                    <option value="ja">🇯🇵 일본어</option>
                    <option value="ko">🇰🇷 한국어</option>
                    <option value="en">🇺🇸 영어</option>
                  </select>
                </div>

                {/* 번역 언어 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-2 font-medium">번역 언어</label>
                  <select
                    defaultValue={project.target_lang}
                    id="settings-target-lang"
                    className="w-full border-2 border-[var(--color-pink-light)] focus:border-[var(--color-pink)] outline-none rounded-lg px-3 py-2.5 bg-white transition-colors"
                  >
                    <option value="ja">🇯🇵 일본어</option>
                    <option value="ko">🇰🇷 한국어</option>
                    <option value="en">🇺🇸 영어</option>
                  </select>
                </div>

                {/* 구분선 */}
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <h3 className="font-bold text-sm text-[var(--color-ink)] mb-3">📤 내보내기 설정</h3>
                </div>

                {/* 내보내기 형식 - ZIP만 지원 (PDF는 향후 추가) */}
                <div>
                  <div className="px-3 py-2 rounded-lg bg-[var(--color-mint-light)] text-center text-xs font-bold text-[var(--color-ink)]">
                    📦 ZIP 형식으로 내보내기
                  </div>
                  <p className="text-[0.65rem] text-gray-500 mt-2">
                    모든 번역된 이미지가 ZIP 파일로 다운로드됩니다
                  </p>
                </div>

                {/* 폰트 선택 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-3 font-medium">✍️ 오버레이 폰트 선택</label>
                  <div className="space-y-2">
                    {availableFonts.length > 0 ? (
                      availableFonts.map((font) => (
                        <button
                          key={font.id}
                          onClick={() => setSelectedFont(font.id)}
                          className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                            selectedFont === font.id
                              ? "border-[var(--color-pink)] bg-[var(--color-pink-light)]"
                              : "border-gray-200 bg-white hover:border-gray-300"
                          }`}
                        >
                          <div className="font-bold text-xs text-[var(--color-ink)]">{font.name}</div>
                          <div className="text-[0.65rem] text-gray-600 mt-1">{font.preview}</div>
                          <div
                            className="mt-2 p-2 bg-gray-50 rounded text-xs font-medium text-gray-700"
                            style={{ fontFamily: font.id === "serif" ? "Georgia, serif" : "Arial, sans-serif" }}
                          >
                            미리보기: 번역된 텍스트 표시
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="text-xs text-gray-500 text-center py-4">폰트 로드 중...</div>
                    )}
                  </div>
                </div>

                {/* 배경 투명도 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-2 font-medium">
                    배경색 투명도: {Math.round(textBackgroundOpacity * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={textBackgroundOpacity}
                    onChange={(e) => setTextBackgroundOpacity(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[0.65rem] text-gray-500 mt-1">낮을수록 원본이 더 보입니다</p>
                </div>
              </div>

              <div className="space-y-3 mt-6">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="font-display font-bold bg-gray-200 text-gray-700 rounded-2xl px-4 py-3 text-sm hover:bg-gray-300 transition-all"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      const name = (document.getElementById("settings-name") as HTMLInputElement).value;
                      const source_lang = (document.getElementById("settings-source-lang") as HTMLSelectElement).value;
                      const target_lang = (document.getElementById("settings-target-lang") as HTMLSelectElement).value;
                      handleUpdateProject({ name, source_lang, target_lang });
                    }}
                    className="font-display font-bold bg-blue-500 text-white rounded-2xl px-4 py-3 text-sm hover:bg-blue-600 transition-all"
                  >
                    저장
                  </button>
                </div>

                {/* 내보내기 버튼 */}
                <button
                  onClick={() => {
                    const font = selectedFont;
                    const opacity = textBackgroundOpacity;

                    // 내보내기 API 호출
                    const params = new URLSearchParams({
                      projectId,
                      format: "zip",
                      font,
                      backgroundOpacity: opacity.toString(),
                    });

                    window.location.href = `/api/export?${params.toString()}`;
                    toast.success("📤 ZIP 내보내기 시작...");
                    setShowSettings(false);
                  }}
                  className="w-full font-display font-bold bg-gradient-to-r from-[var(--color-mint)] to-[var(--color-pink)] text-white rounded-2xl px-4 py-3 text-sm hover:opacity-90 transition-all"
                >
                  📦 ZIP으로 내보내기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
