"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { shareFile } from "@/lib/ebike/gpx";
import {
  createBackup,
  generateSyncCode,
  loadLastSync,
  normalizeSyncCode,
  restoreBackup,
  saveSyncCode,
  syncNow,
} from "@/lib/ebike/sync";
import { Section } from "./ui";

type Props = {
  code: string | null;
  onCodeChange: (code: string | null) => void;
  /** 동기화·복원으로 데이터가 바뀌었을 때 화면 새로고침 */
  onDataChanged: () => void;
};

export default function SyncSection({ code, onCodeChange, onDataChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [lastSync, setLastSync] = useState(loadLastSync);
  const fileRef = useRef<HTMLInputElement>(null);

  const runSync = async (c: string) => {
    setBusy(true);
    try {
      const r = await syncNow(c);
      setLastSync(Date.now());
      onDataChanged();
      toast.success(`동기화 완료 · 올림 ${r.uploaded}개 · 받음 ${r.downloaded}개`);
      return true;
    } catch (err) {
      toast.error(`동기화 실패: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const connect = async (c: string) => {
    if (await runSync(c)) {
      saveSyncCode(c);
      onCodeChange(c);
      setShowCode(true);
      setInput("");
    }
  };

  const joinWithCode = () => {
    const c = normalizeSyncCode(input);
    if (!c) {
      toast.error("코드 16자리를 정확히 입력해 주세요 (예: ABCD-EFGH-JKLM-NPQR)");
      return;
    }
    connect(c);
  };

  const disconnect = () => {
    if (!confirm("이 기기의 동기화를 해제할까요? 이 기기의 기록은 그대로 남습니다.")) return;
    saveSyncCode(null);
    onCodeChange(null);
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success("코드를 복사했습니다");
    } catch {
      toast.error("복사하지 못했습니다");
    }
  };

  const exportBackup = async () => {
    const d = new Date();
    const name = `ebike-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
    await shareFile(name, await createBackup(), "application/json");
  };

  const importBackup = async (file: File) => {
    setBusy(true);
    try {
      const added = await restoreBackup(await file.text());
      onDataChanged();
      toast.success(`백업을 불러왔습니다 · 주행 기록 ${added}개 추가`);
    } catch (err) {
      toast.error(`불러오기 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Section title="백업 · 여러 기기 동기화">
      {code ? (
        <>
          <div className="text-sm">
            ✅ 동기화 켜짐
            <span className="ml-2 text-xs text-slate-400">
              {lastSync ? `마지막 동기화 ${new Date(lastSync).toLocaleString("ko-KR")}` : ""}
            </span>
          </div>
          <div className="rounded-lg bg-slate-900 p-2 text-center">
            <div className="text-[11px] text-slate-400">동기화 코드 (다른 기기에서 입력)</div>
            <button onClick={() => setShowCode(!showCode)} className="font-mono text-lg tracking-wider">
              {showCode ? code : "••••-••••-••••-" + code.slice(-4)}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <button disabled={busy} onClick={() => runSync(code)} className="rounded-lg bg-blue-600 py-2 font-semibold disabled:opacity-60">
              {busy ? "동기화 중…" : "지금 동기화"}
            </button>
            <button onClick={copyCode} className="rounded-lg bg-slate-700 py-2">
              코드 복사
            </button>
            <button onClick={disconnect} className="rounded-lg bg-slate-700 py-2 text-red-300">
              해제
            </button>
          </div>
          <p className="text-xs text-slate-500">
            앱을 열 때와 주행을 마칠 때 자동으로 동기화합니다. 코드를 아는 사람은 기록을 볼 수 있으니 다른 사람에게
            알려주지 마세요.
          </p>
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-slate-400">
            휴대폰을 바꾸거나 여러 기기에서 같은 기록을 보려면 동기화를 켜세요. 처음 기기에서 코드를 만들고, 다른
            기기에서 그 코드를 입력하면 됩니다.
          </p>
          <button
            disabled={busy}
            onClick={() => connect(generateSyncCode())}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold disabled:opacity-60"
          >
            {busy ? "연결 중…" : "새 동기화 코드 만들기"}
          </button>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="다른 기기의 코드 입력"
              autoCapitalize="characters"
              autoCorrect="off"
              className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2 font-mono text-base uppercase outline-none ring-blue-500 focus:ring-2"
            />
            <button disabled={busy} onClick={joinWithCode} className="rounded-lg bg-slate-700 px-3 text-sm disabled:opacity-60">
              연결
            </button>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-2 border-t border-slate-700 pt-3 text-sm">
        <button onClick={exportBackup} className="rounded-lg bg-slate-700 py-2">
          ⤴︎ 백업 파일 저장
        </button>
        <button disabled={busy} onClick={() => fileRef.current?.click()} className="rounded-lg bg-slate-700 py-2 disabled:opacity-60">
          ⤵︎ 백업 불러오기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importBackup(f);
          }}
        />
      </div>
      <p className="text-xs text-slate-500">
        백업 파일은 공유 창에서 “파일에 저장”을 고르면 iCloud Drive에 보관할 수 있습니다.
      </p>
    </Section>
  );
}
