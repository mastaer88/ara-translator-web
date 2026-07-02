"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type Project = {
  id: string;
  name: string;
  source_lang: string;
  target_lang: string;
  created_at: string;
};

type Job = {
  id: string;
  project_id: string;
  page_id: string;
  type: string;
  status: string;
  progress: number;
  created_at: string;
};

type LoraStats = {
  id: string;
  project_id: string;
  total_pairs: number;
  reviewed_pairs: number;
  high_quality_pairs: number;
  training_status: string;
  training_progress: number;
};

const LANGS = [
  { code: "ja", label: "일본어", flag: "🇯🇵" },
  { code: "ko", label: "한국어", flag: "🇰🇷" },
  { code: "en", label: "영어", flag: "🇺🇸" },
];

const CARD_ACCENTS = [
  "border-pink-light hover:shadow-[0_6px_0_var(--color-pink-light)]",
  "border-lavender-light hover:shadow-[0_6px_0_var(--color-lavender-light)]",
  "border-mint-light hover:shadow-[0_6px_0_var(--color-mint-light)]",
  "border-butter-light hover:shadow-[0_6px_0_var(--color-butter-light)]",
];

function langMeta(code: string) {
  return LANGS.find((l) => l.code === code);
}

const STATUS_EMOJI: Record<string, string> = {
  pending: "⏳",
  running: "🔄",
  completed: "✅",
  failed: "❌",
};

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [runningJobs, setRunningJobs] = useState<Job[]>([]);
  const [loraStats, setLoraStats] = useState<LoraStats[]>([]);
  const [name, setName] = useState("");
  const [sourceLang, setSourceLang] = useState("ja");
  const [targetLang, setTargetLang] = useState("ko");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [autoUploading, setAutoUploading] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [detectedLangFromUpload, setDetectedLangFromUpload] = useState<string | null>(null);
  const [showLangConfirm, setShowLangConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadProjects() {
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects(data.projects ?? []);
  }

  async function loadJobs() {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    setRunningJobs(data.running ?? []);
    setLoraStats(data.loraStats ?? []);
  }

  useEffect(() => {
    loadProjects();
    loadJobs();

    // 첫 방문 시 온보딩 표시
    if (typeof window !== "undefined") {
      const onboardingSeen = localStorage.getItem("onboarding_seen");
      if (!onboardingSeen) {
        setShowOnboarding(true);
        localStorage.setItem("onboarding_seen", "true");
      }
    }

    // 5초마다 갱신
    const interval = setInterval(() => {
      loadJobs();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, source_lang: sourceLang, target_lang: targetLang }),
      });
      const data = await res.json();
      if (data.project) {
        setName("");
        toast.success(`✨ "${data.project.name}" 프로젝트 생성됨`, {
          description: `${sourceLang} → ${targetLang} 번역 준비 완료!`,
        });
        router.push(`/project/${data.project.id}`);
      } else {
        toast.error("프로젝트 생성 실패", {
          description: data.error || "다시 시도해주세요",
        });
      }
    } catch (e) {
      toast.error("프로젝트 생성 실패", {
        description: (e as Error).message,
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(projectId: string) {
    if (!confirm("정말 이 프로젝트를 삭제할까요? 모든 데이터가 제거됩니다.")) return;

    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (res.ok) {
        await loadProjects();
        toast.success("프로젝트 삭제됨", {
          description: "프로젝트와 모든 데이터가 제거되었습니다",
        });
      } else {
        toast.error("삭제 실패", { description: "다시 시도해주세요" });
      }
    } catch (e) {
      toast.error("삭제 중 오류 발생");
    }
  }

  async function handleAutoUpload(files: FileList) {
    if (files.length === 0) return;

    setAutoUploading(true);
    const loadingToast = toast.loading("📥 파일 업로드 중...");

    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("files", f));

      toast.loading("🔄 언어 감지 중...", { id: loadingToast });

      const res = await fetch("/api/auto-upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("자동 업로드 실패");

      const data = await res.json();
      console.log("Auto upload result:", data);

      // 감지된 언어 저장 후 확인 모달 표시
      setDetectedLangFromUpload(data.sourceLang);
      setShowLangConfirm(true);

      toast.dismiss(loadingToast);
      setAutoUploading(false);
      setDragging(false);
    } catch (e) {
      toast.error("자동 업로드 실패", {
        id: loadingToast,
        description: (e as Error).message,
      });
      setAutoUploading(false);
      setDragging(false);
    }
  }

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="min-h-screen py-14 px-6">
      {/* 온보딩 모달 */}
      {showOnboarding && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md p-8 animate-in fade-in zoom-in-95">
            <div className="text-6xl mb-4 text-center">🎉</div>
            <h2 className="text-2xl font-display font-bold text-[var(--color-ink)] mb-3 text-center">
              아라 번역에 오신 것을 환영합니다!
            </h2>
            <p className="text-sm text-[var(--color-ink-soft)] mb-6 text-center leading-relaxed">
              만화와 이미지를 OCR로 읽고 자동으로 번역해드립니다.
            </p>

            <div className="space-y-3 mb-6">
              <div className="flex gap-3 items-start">
                <span className="text-xl">📥</span>
                <div>
                  <div className="font-bold text-sm text-[var(--color-ink)]">파일 드래그</div>
                  <div className="text-xs text-[var(--color-ink-soft)]">
                    이미지를 드래그해서 자동으로 프로젝트를 만들어보세요
                  </div>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-xl">✨</span>
                <div>
                  <div className="font-bold text-sm text-[var(--color-ink)]">새 프로젝트</div>
                  <div className="text-xs text-[var(--color-ink-soft)]">
                    언어를 선택해서 새 프로젝트를 직접 만들 수도 있습니다
                  </div>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-xl">🔄</span>
                <div>
                  <div className="font-bold text-sm text-[var(--color-ink)]">OCR & 번역</div>
                  <div className="text-xs text-[var(--color-ink-soft)]">
                    OCR로 텍스트를 인식하고 실시간으로 번역합니다
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowOnboarding(false)}
              className="w-full font-display font-bold bg-[var(--color-pink)] text-white rounded-2xl px-4 py-3 shadow-[0_4px_0_#e06f92] active:translate-y-0.5 active:shadow-[0_1px_0_#e06f92] transition-all"
            >
              시작하기 🚀
            </button>
          </div>
        </div>
      )}

      {/* 언어 확인 모달 */}
      {showLangConfirm && detectedLangFromUpload && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md p-8 animate-in fade-in zoom-in-95">
            <div className="text-5xl mb-4 text-center">🔍</div>
            <h2 className="text-2xl font-display font-bold text-[var(--color-ink)] mb-2 text-center">
              언어 확인
            </h2>
            <p className="text-sm text-[var(--color-ink-soft)] mb-6 text-center">
              파일에서 감지된 원문 언어입니다. 맞으면 계속, 틀리면 수정해주세요.
            </p>

            <div className="bg-[var(--color-mint-light)] rounded-2xl p-4 mb-6 border-2 border-[var(--color-mint)]">
              <div className="text-center">
                <div className="text-3xl mb-2">
                  {detectedLangFromUpload === "ja" ? "🇯🇵" : detectedLangFromUpload === "ko" ? "🇰🇷" : "🇺🇸"}
                </div>
                <div className="font-bold text-lg text-[var(--color-ink)]">
                  {detectedLangFromUpload === "ja" ? "일본어" : detectedLangFromUpload === "ko" ? "한국어" : "영어"}
                </div>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-gray-600 mb-2 font-medium">원문 언어 선택</label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full border-2 border-[var(--color-mint-light)] focus:border-[var(--color-mint)] outline-none rounded-lg px-3 py-2.5 bg-white transition-colors"
              >
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setShowLangConfirm(false);
                  setDetectedLangFromUpload(null);
                  toast.info("취소되었습니다");
                }}
                className="font-display font-bold bg-gray-200 text-gray-700 rounded-2xl px-4 py-3 text-sm hover:bg-gray-300 transition-all"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowLangConfirm(false);
                  setTargetLang(sourceLang === "ja" ? "ko" : sourceLang === "ko" ? "ja" : "en");
                  toast.success("✨ 프로젝트 생성 중...");
                  handleCreate(new Event("submit") as any);
                  setDetectedLangFromUpload(null);
                }}
                className="font-display font-bold bg-[var(--color-pink)] text-white rounded-2xl px-4 py-3 text-sm shadow-[0_4px_0_#e06f92] active:translate-y-0.5 active:shadow-[0_1px_0_#e06f92] transition-all"
              >
                계속 🚀
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl">
        <div className="mb-10 text-center sm:text-left">
          <h1 className="font-display text-4xl font-extrabold text-[var(--color-ink)] tracking-tight">
            아라 번역 🌸
          </h1>
          <p className="text-[var(--color-ink-soft)] mt-1">
            이미지 · 만화를 OCR로 읽고 살포시 번역해드려요
          </p>
        </div>

        {/* 드래그 드롭 영역 */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length > 0) {
              handleAutoUpload(e.dataTransfer.files);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-10 p-8 rounded-3xl border-4 border-dashed transition-all text-center cursor-pointer ${
            dragging
              ? "border-[var(--color-pink)] bg-[var(--color-pink-light)] scale-105"
              : "border-[var(--color-lavender-light)] bg-[var(--color-lavender-light)]/20 hover:border-[var(--color-pink)]"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.zip"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleAutoUpload(e.target.files);
              }
            }}
            className="hidden"
          />
          <div className="text-4xl mb-3">
            {autoUploading ? "🔄" : "📥"}
          </div>
          <div className="font-display font-bold text-[var(--color-ink)] mb-1">
            {autoUploading ? "언어 감지 중..." : "이미지를 여기에 드롭하거나 클릭"}
          </div>
          <div className="text-sm text-[var(--color-ink-soft)]">
            {autoUploading
              ? "OCR 실행 중 • 언어 감지 중"
              : "자동으로 언어를 감지하고 프로젝트를 만들어드립니다"}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          {/* 프로젝트 생성 */}
          <form
            onSubmit={handleCreate}
            className="lg:col-span-1 bg-white/90 backdrop-blur border-2 border-[var(--color-pink-light)] rounded-3xl p-6 flex flex-col gap-4 shadow-[0_6px_0_var(--color-pink-light)]"
          >
            <h2 className="font-display font-bold text-lg text-[var(--color-ink)] flex items-center gap-2">
              ✨ 새 프로젝트
            </h2>
            <input
              className="border-2 border-[var(--color-lavender-light)] focus:border-[var(--color-lavender)] outline-none rounded-2xl px-4 py-2.5 text-sm transition-colors placeholder:text-[var(--color-ink-soft)]"
              placeholder="예) 오늘의 만화"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex flex-col gap-2 text-xs">
              <label className="text-[var(--color-ink-soft)] font-medium">
                원문
                <select
                  className="mt-0.5 w-full border-2 border-[var(--color-mint-light)] focus:border-[var(--color-mint)] outline-none rounded-lg px-2 py-1.5 bg-white transition-colors"
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value)}
                >
                  {LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[var(--color-ink-soft)] font-medium">
                번역
                <select
                  className="mt-0.5 w-full border-2 border-[var(--color-mint-light)] focus:border-[var(--color-mint)] outline-none rounded-lg px-2 py-1.5 bg-white transition-colors"
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                >
                  {LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="font-display font-bold bg-[var(--color-pink)] text-white rounded-2xl px-4 py-3 text-sm shadow-[0_4px_0_#e06f92] active:translate-y-0.5 active:shadow-[0_1px_0_#e06f92] transition-all disabled:opacity-50"
            >
              {creating ? "만드는 중..." : "생성하기 🚀"}
            </button>
          </form>

          {/* 진행 중인 작업 모니터 */}
          <div className="lg:col-span-1 bg-white/90 backdrop-blur border-2 border-[var(--color-butter-light)] rounded-3xl p-6 shadow-[0_6px_0_var(--color-butter-light)]">
            <h3 className="font-display font-bold text-lg text-[var(--color-ink)] mb-4 flex items-center gap-2">
              🔄 진행 중인 작업 ({runningJobs.length})
            </h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {runningJobs.length === 0 ? (
                <div className="text-xs text-[var(--color-ink-soft)] text-center py-6">
                  작업이 없습니다
                </div>
              ) : (
                runningJobs.map((job) => {
                  const project = projectMap.get(job.project_id);
                  return (
                    <div
                      key={job.id}
                      className="text-xs bg-gradient-to-r from-[var(--color-butter-light)] to-white rounded-lg p-2.5 border-l-3 border-[var(--color-butter)]"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-[var(--color-ink)]">
                          {STATUS_EMOJI[job.status]} {job.type}
                        </span>
                        <span className="text-[var(--color-ink-soft)]">{job.progress}%</span>
                      </div>
                      <div className="text-[var(--color-ink-soft)]">
                        {project?.name || "프로젝트"}
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                        <div
                          className="bg-[var(--color-butter)] h-1.5 rounded-full transition-all"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* LoRA 학습 데이터 통계 */}
          <div className="lg:col-span-1 bg-white/90 backdrop-blur border-2 border-[var(--color-mint-light)] rounded-3xl p-6 shadow-[0_6px_0_var(--color-mint-light)]">
            <h3 className="font-display font-bold text-lg text-[var(--color-ink)] mb-4 flex items-center gap-2">
              📚 LoRA 학습 데이터
            </h3>
            <div className="space-y-3">
              {loraStats.length === 0 ? (
                <div className="text-xs text-[var(--color-ink-soft)] text-center py-6">
                  데이터가 없습니다
                </div>
              ) : (
                loraStats.slice(0, 3).map((stat) => {
                  const project = projectMap.get(stat.project_id);
                  const totalValid = stat.high_quality_pairs;
                  const reviewedPercent =
                    stat.total_pairs > 0
                      ? Math.round((stat.reviewed_pairs / stat.total_pairs) * 100)
                      : 0;

                  return (
                    <div
                      key={stat.id}
                      className="text-xs bg-gradient-to-r from-[var(--color-mint-light)] to-white rounded-lg p-2.5 border-l-3 border-[var(--color-mint)]"
                    >
                      <div className="font-bold text-[var(--color-ink)] mb-1.5">
                        {project?.name || "프로젝트"}
                      </div>

                      {/* 통계 바 */}
                      <div className="space-y-1.5">
                        <div>
                          <div className="flex justify-between mb-0.5 text-[var(--color-ink-soft)]">
                            <span>수집됨</span>
                            <span>{stat.total_pairs}개</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1">
                            <div
                              className="bg-[var(--color-butter)] h-1 rounded-full"
                              style={{
                                width: `${Math.min((stat.total_pairs / 100) * 100, 100)}%`,
                              }}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between mb-0.5 text-[var(--color-ink-soft)]">
                            <span>검증됨</span>
                            <span>{reviewedPercent}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1">
                            <div
                              className="bg-[var(--color-pink)] h-1 rounded-full"
                              style={{ width: `${reviewedPercent}%` }}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between mb-0.5 text-[var(--color-ink-soft)]">
                            <span>고품질</span>
                            <span>{totalValid}개</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1">
                            <div
                              className="bg-[var(--color-mint)] h-1 rounded-full"
                              style={{
                                width: `${
                                  stat.total_pairs > 0
                                    ? (totalValid / stat.total_pairs) * 100
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* 학습 상태 */}
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <span
                          className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                            stat.training_status === "completed"
                              ? "bg-emerald-100 text-emerald-700"
                              : stat.training_status === "training"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {stat.training_status === "completed"
                            ? "✓ 학습 완료"
                            : stat.training_status === "training"
                            ? `🔄 학습 중 (${stat.training_progress}%)`
                            : "대기 중"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* 프로젝트 목록 */}
        <div>
          <h2 className="font-display font-bold text-lg text-[var(--color-ink)] mb-4">
            📁 프로젝트 ({projects.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p, i) => {
              const src = langMeta(p.source_lang);
              const dst = langMeta(p.target_lang);
              return (
                <div key={p.id} className="relative group">
                  <button
                    onClick={() => router.push(`/project/${p.id}`)}
                    className={`w-full text-left bg-white rounded-2xl px-4 py-3 border-2 transition-all hover:-translate-y-0.5 ${CARD_ACCENTS[i % CARD_ACCENTS.length]}`}
                  >
                    <div className="font-display font-bold text-[var(--color-ink)] text-sm">
                      {p.name}
                    </div>
                    <div className="text-xs text-[var(--color-ink-soft)] mt-1 flex items-center gap-1 flex-wrap">
                      <span>{src?.flag ?? p.source_lang}</span>
                      <span>{src?.label ?? p.source_lang}</span>
                      <span className="mx-0.5">→</span>
                      <span>{dst?.flag ?? p.target_lang}</span>
                      <span>{dst?.label ?? p.target_lang}</span>
                      <span className="ml-auto opacity-60">
                        {new Date(p.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </button>

                  {/* 삭제 버튼 (호버 시 표시) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(p.id);
                    }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600"
                  >
                    삭제 ❌
                  </button>
                </div>
              );
            })}
            {projects.length === 0 && (
              <div className="col-span-full text-center text-[var(--color-ink-soft)] bg-white/60 border-2 border-dashed border-[var(--color-lavender-light)] rounded-3xl py-10">
                <div className="text-3xl mb-2">🐣</div>
                아직 프로젝트가 없어요
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
