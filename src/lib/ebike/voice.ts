/**
 * Web Speech API 기반 음성 안내.
 * iOS Safari는 사용자 터치 이벤트 안에서 한 번 speak()를 호출해야 이후 음성이 재생되므로
 * 시작 버튼 등에서 unlock()을 호출해야 한다.
 */
export type VoiceOptions = { rate: number; volume: number; voiceURI: string | null };

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
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

export function speak(text: string, opts: VoiceOptions, interrupt = false) {
  const s = synth();
  if (!s) return;
  if (interrupt) s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = opts.rate;
  u.volume = opts.volume;
  const voices = getKoreanVoices();
  const voice = voices.find((v) => v.voiceURI === opts.voiceURI) ?? voices[0];
  if (voice) u.voice = voice;
  s.speak(u);
}
