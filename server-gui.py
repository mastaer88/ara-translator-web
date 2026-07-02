#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import subprocess
import threading
import os
import signal
import sys
import webbrowser
from datetime import datetime
from pathlib import Path

class ServerManager:
    def __init__(self, root):
        self.root = root
        self.root.title("🌐 Ara Translator Web - Server Manager")
        self.root.geometry("900x700")
        self.root.resizable(True, True)

        # 프로세스 및 로그 파일 설정
        self.project_dir = Path(__file__).parent
        self.log_dir = self.project_dir / "logs"
        self.log_dir.mkdir(exist_ok=True)
        self.pid_file = self.project_dir / ".server.pid"

        self.server_process = None
        self.is_running = False

        self.setup_ui()
        self.check_server_status()

    def setup_ui(self):
        # 상단 상태 표시 영역
        status_frame = ttk.Frame(self.root)
        status_frame.pack(fill=tk.X, padx=10, pady=10)

        ttk.Label(status_frame, text="상태:", font=("Arial", 11, "bold")).pack(side=tk.LEFT, padx=5)
        self.status_label = ttk.Label(status_frame, text="⚫ 중지됨", font=("Arial", 11), foreground="red")
        self.status_label.pack(side=tk.LEFT, padx=5)

        # 버튼 영역
        button_frame = ttk.Frame(self.root)
        button_frame.pack(fill=tk.X, padx=10, pady=10)

        self.start_btn = ttk.Button(button_frame, text="🚀 서버 시작", command=self.start_server, width=20)
        self.start_btn.pack(side=tk.LEFT, padx=5)

        self.stop_btn = ttk.Button(button_frame, text="🛑 서버 중지", command=self.stop_server, width=20, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT, padx=5)

        self.restart_btn = ttk.Button(button_frame, text="🔄 재시작", command=self.restart_server, width=20, state=tk.DISABLED)
        self.restart_btn.pack(side=tk.LEFT, padx=5)

        self.open_btn = ttk.Button(button_frame, text="🌐 웹사이트 열기", command=self.open_website, width=20, state=tk.DISABLED)
        self.open_btn.pack(side=tk.LEFT, padx=5)

        self.update_btn = ttk.Button(button_frame, text="⬆️ 업데이트", command=self.update_code, width=15)
        self.update_btn.pack(side=tk.LEFT, padx=5)

        self.clear_btn = ttk.Button(button_frame, text="🗑️ 로그 지우기", command=self.clear_logs, width=20)
        self.clear_btn.pack(side=tk.LEFT, padx=5)

        # 로그 영역
        log_label = ttk.Label(self.root, text="📋 실시간 로그", font=("Arial", 11, "bold"))
        log_label.pack(anchor=tk.W, padx=10, pady=(10, 5))

        # 로그 텍스트 영역
        self.log_text = scrolledtext.ScrolledText(
            self.root,
            height=25,
            width=100,
            font=("Courier New", 9),
            bg="#1e1e1e",
            fg="#00ff00",
            insertbackground="#00ff00"
        )
        self.log_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        self.log_text.config(state=tk.DISABLED)

        # 하단 정보 영역
        info_frame = ttk.Frame(self.root)
        info_frame.pack(fill=tk.X, padx=10, pady=10)

        ttk.Label(info_frame, text=f"📁 로그 폴더: {self.log_dir}", font=("Arial", 9)).pack(anchor=tk.W)
        ttk.Label(info_frame, text=f"📂 프로젝트: {self.project_dir}", font=("Arial", 9)).pack(anchor=tk.W)

    def log(self, message):
        """로그에 메시지 추가"""
        self.log_text.config(state=tk.NORMAL)
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)
        self.log_text.config(state=tk.DISABLED)

        # 파일에도 저장
        log_file = self.log_dir / f"server-{datetime.now().strftime('%Y-%m-%d')}.log"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")

    def update_status(self):
        """서버 상태 업데이트"""
        if self.is_running:
            self.status_label.config(text="✅ 실행 중", foreground="green")
            self.start_btn.config(state=tk.DISABLED)
            self.stop_btn.config(state=tk.NORMAL)
            self.restart_btn.config(state=tk.NORMAL)
            self.open_btn.config(state=tk.NORMAL)
        else:
            self.status_label.config(text="⚫ 중지됨", foreground="red")
            self.start_btn.config(state=tk.NORMAL)
            self.stop_btn.config(state=tk.DISABLED)
            self.restart_btn.config(state=tk.DISABLED)
            self.open_btn.config(state=tk.DISABLED)

    def check_server_status(self):
        """서버 상태 확인"""
        try:
            if self.pid_file.exists():
                pid = int(self.pid_file.read_text().strip())
                # 프로세스가 실행 중인지 확인
                os.kill(pid, 0)
                self.is_running = True
            else:
                self.is_running = False
        except (ValueError, OSError, ProcessLookupError):
            self.is_running = False

        self.update_status()

    def start_server(self):
        """서버 시작"""
        if self.is_running:
            messagebox.showwarning("경고", "서버가 이미 실행 중입니다.")
            return

        self.log("🚀 서버 시작 중...")

        # 포트 3000 점유 프로세스 자동 종료
        try:
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True,
                text=True
            )
            for line in result.stdout.split('\n'):
                if ':3000' in line and 'LISTENING' in line:
                    parts = line.split()
                    if parts:
                        pid = parts[-1]
                        self.log(f"⚠️  포트 3000을 점유한 프로세스(PID: {pid})를 종료합니다...")
                        subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True)
                        break
        except:
            pass

        def run_server():
            try:
                # Windows에서 npm.cmd 사용 또는 shell=True
                cmd = "npm run dev"
                self.server_process = subprocess.Popen(
                    cmd,
                    cwd=str(self.project_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    universal_newlines=True,
                    encoding='utf-8',
                    errors='replace',
                    bufsize=1,
                    shell=True,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
                )

                # PID 저장
                self.pid_file.write_text(str(self.server_process.pid))
                self.is_running = True
                self.log(f"✅ 서버 시작됨 (PID: {self.server_process.pid})")
                self.update_status()

                # 로그 읽기
                for line in self.server_process.stdout:
                    if line.strip():
                        self.log(f"[STDOUT] {line.strip()}")

                self.server_process.wait()
                self.is_running = False
                self.log(f"⚠️ 서버 종료됨 (코드: {self.server_process.returncode})")

            except Exception as e:
                self.log(f"❌ 오류: {str(e)}")
                self.is_running = False
            finally:
                self.update_status()

        thread = threading.Thread(target=run_server, daemon=True)
        thread.start()

    def stop_server(self):
        """서버 중지"""
        if not self.is_running:
            messagebox.showwarning("경고", "실행 중인 서버가 없습니다.")
            return

        self.log("🛑 서버 중지 중...")

        try:
            if self.pid_file.exists():
                pid = int(self.pid_file.read_text().strip())
                os.kill(pid, signal.SIGTERM)
                self.log(f"✅ 서버 중지 신호 전송 (PID: {pid})")
                self.pid_file.unlink()
        except Exception as e:
            self.log(f"❌ 오류: {str(e)}")

        self.is_running = False
        self.update_status()

    def restart_server(self):
        """서버 재시작"""
        self.log("🔄 서버 재시작 중...")
        self.stop_server()
        self.root.after(2000, self.start_server)

    def clear_logs(self):
        """로그 지우기"""
        if messagebox.askyesno("확인", "로그를 정말 지우시겠습니까?"):
            self.log_text.config(state=tk.NORMAL)
            self.log_text.delete(1.0, tk.END)
            self.log_text.config(state=tk.DISABLED)
            self.log("🗑️ 로그가 지워졌습니다.")

    def open_website(self):
        """웹사이트 열기"""
        try:
            # 3000~3010 포트 중 실행 중인 포트 찾기
            for port in range(3000, 3011):
                try:
                    import socket
                    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    result = sock.connect_ex(('localhost', port))
                    sock.close()
                    if result == 0:
                        url = f"http://localhost:{port}"
                        self.log(f"🌐 웹사이트 열기: {url}")
                        webbrowser.open(url)
                        return
                except:
                    pass

            # 포트를 찾지 못한 경우 기본 3000 포트 사용
            url = "http://localhost:3000"
            self.log(f"🌐 웹사이트 열기: {url}")
            webbrowser.open(url)
        except Exception as e:
            self.log(f"❌ 웹사이트 열기 오류: {str(e)}")
            messagebox.showerror("오류", f"웹사이트를 열 수 없습니다: {str(e)}")

    def update_code(self):
        """코드 업데이트"""
        self.log("⬆️ 업데이트 확인 중...")

        def run_update():
            try:
                # git pull 실행
                result = subprocess.run(
                    ["git", "pull"],
                    cwd=str(self.project_dir),
                    capture_output=True,
                    text=True,
                    timeout=30
                )

                if result.returncode == 0:
                    output = result.stdout.strip()
                    if "Already up to date" in output or "Already up-to-date" in output:
                        self.log("✅ 이미 최신 버전입니다")
                        messagebox.showinfo("업데이트", "이미 최신 버전입니다.")
                    else:
                        self.log(f"✅ 업데이트 완료!\n{output}")
                        # 업데이트 후 서버 재시작 여부 확인
                        if messagebox.askyesno("업데이트 완료", "서버를 재시작하시겠습니까?"):
                            self.log("🔄 서버 재시작 중...")
                            self.restart_server()
                        else:
                            messagebox.showinfo("안내", "변경사항을 적용하려면 서버를 재시작하세요.")
                else:
                    error_msg = result.stderr.strip() or result.stdout.strip()
                    self.log(f"❌ 업데이트 실패: {error_msg}")
                    messagebox.showerror("업데이트 실패", f"업데이트 중 오류가 발생했습니다:\n{error_msg}")
            except subprocess.TimeoutExpired:
                self.log("❌ 업데이트 시간 초과")
                messagebox.showerror("오류", "업데이트 시간이 초과되었습니다.")
            except FileNotFoundError:
                self.log("❌ Git이 설치되지 않았습니다")
                messagebox.showerror("오류", "Git이 설치되지 않았습니다.")
            except Exception as e:
                self.log(f"❌ 업데이트 오류: {str(e)}")
                messagebox.showerror("오류", f"업데이트 중 오류: {str(e)}")

        thread = threading.Thread(target=run_update, daemon=True)
        thread.start()

if __name__ == "__main__":
    root = tk.Tk()
    app = ServerManager(root)

    def on_closing():
        if app.is_running:
            if messagebox.askokcancel("종료", "실행 중인 서버를 중지하고 종료하시겠습니까?"):
                app.stop_server()
                root.destroy()
        else:
            root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_closing)
    root.mainloop()
