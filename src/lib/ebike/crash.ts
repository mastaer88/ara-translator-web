/**
 * 넘어짐(사고) 감지.
 * 강한 충격(가속도 약 3g 이상)이 있은 뒤, 직전까지 달리던 자전거가 10초 이상 멈춰 있으면 사고로 의심한다.
 * iOS는 사용자 터치 안에서 requestMotionPermission()을 불러야 센서를 쓸 수 있다.
 */
const IMPACT_MS2 = 30; // ≈ 3g (중력 포함)
const MOVING_KMH = 12;
const STILL_KMH = 3;
const STILL_SEC = 10;

type MotionPermissionApi = { requestPermission?: () => Promise<"granted" | "denied"> };

export async function requestMotionPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return false;
  const api = DeviceMotionEvent as unknown as MotionPermissionApi;
  if (typeof api.requestPermission !== "function") return true; // 권한 요청이 필요 없는 브라우저
  try {
    return (await api.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export class CrashDetector {
  private impactAt: number | null = null;
  private lastMovingAt = 0;
  private stillSince: number | null = null;
  private triggered = false;
  private readonly onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const g = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    // 충격 직전 5초 안에 달리고 있었을 때만 (들고 걷다 떨어뜨린 경우 등 제외)
    if (g >= IMPACT_MS2 && Date.now() - this.lastMovingAt < 5000) this.impactAt = Date.now();
  };

  constructor(private readonly onSuspect: () => void) {}

  start() {
    window.addEventListener("devicemotion", this.onMotion);
  }

  stop() {
    window.removeEventListener("devicemotion", this.onMotion);
    this.reset();
  }

  reset() {
    this.impactAt = null;
    this.stillSince = null;
    this.triggered = false;
  }

  /** GPS 속도가 들어올 때마다 호출 */
  feedSpeed(kmh: number, now = Date.now()) {
    if (kmh >= MOVING_KMH) this.lastMovingAt = now;
    if (kmh > STILL_KMH) {
      this.stillSince = null;
      // 충격 후 다시 달리면 괜찮은 것
      if (this.impactAt && now - this.impactAt > 3000) this.impactAt = null;
      return;
    }
    if (this.impactAt === null || this.triggered) return;
    this.stillSince ??= now;
    if (now - this.stillSince >= STILL_SEC * 1000) {
      this.triggered = true;
      this.onSuspect();
    }
  }
}
