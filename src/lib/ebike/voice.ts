/**
 * Web Speech API 기반 음성 안내.
 * iOS Safari는 사용자 터치 이벤트 안에서 한 번 speak()를 호출해야 이후 음성이 재생되므로
 * 시작 버튼 등에서 unlock()을 호출해야 한다.
 */
export type VoiceOptions = {
  rate: number;
  volume: number;
  voiceURI: string | null;
};

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

export function isSpeechSupported(): boolean {
  return synth() !== null;
}

export function getKoreanVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  return s.getVoices().filter((v) => v.lang.toLowerCase().startsWith("ko"));
}

let unlocked = false;

export function unlockSpeech() {
  const s = synth();
  if (!s || unlocked) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  s.speak(u);
  unlocked = true;
}

// Safari는 재생 중인 발화 객체가 가비지 컬렉션되면 소리가 끊기므로 끝날 때까지 참조를 유지한다
const pending = new Set<SpeechSynthesisUtterance>();

export function speak(text: string, opts: VoiceOptions, interrupt = false) {
  const s = synth();
  if (!s) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = opts.rate;
  u.volume = opts.volume;
  const voices = getKoreanVoices();
  const voice = voices.find((v) => v.voiceURI === opts.voiceURI) ?? voices[0];
  if (voice) u.voice = voice;
  pending.add(u);
  u.onend = u.onerror = () => pending.delete(u);

  // 백그라운드에서 돌아온 뒤 일시정지 상태로 남아 있는 경우가 있음 (iOS)
  if (s.paused) s.resume();
  if (interrupt && (s.speaking || s.pending)) {
    s.cancel();
    // iOS Safari는 cancel() 직후 바로 speak()하면 무시하는 경우가 있어 잠깐 기다린다
    setTimeout(() => s.speak(u), 120);
  } else {
    s.speak(u);
  }
}

/** 말하는 중인 안내를 멈춤 (음성 명령을 듣기 전에) */
export function stopSpeech() {
  const s = synth();
  if (s && (s.speaking || s.pending)) s.cancel();
}
