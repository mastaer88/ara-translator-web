/**
 * 음성 명령: 아이폰 Safari 음성 인식(webkitSpeechRecognition) + 한국어 명령 해석.
 */

export type VoiceCommand =
  | { type: "sos" }
  | { type: "parkSave" }
  | { type: "parkGo" }
  | { type: "home" }
  | { type: "work" }
  | { type: "battery" }
  | { type: "speed" }
  | { type: "eta" }
  | { type: "stopNav" }
  | { type: "startRide" }
  | { type: "endRide" }
  | { type: "weather" }
  | { type: "nearby"; kind: string }
  | { type: "go"; query: string }
  | { type: "unknown"; text: string };

/** 말로 부를 수 있는 주변 찾기 종류 → NEARBY_KINDS의 id */
const NEARBY_WORDS: [RegExp, string][] = [
  [/편의점/, "CS2"],
  [/화장실/, "toilet"],
  [/(자전거\s*)?(수리|정비|수리점|펑크)/, "repair"],
  [/(카페|커피)/, "CE7"],
  [/(음식점|식당|밥\s*집|맛집)/, "FD6"],
  [/(지하철|전철)/, "SW8"],
  [/약국/, "PM9"],
  [/병원/, "HP8"],
];

const GO_SUFFIX =
  /\s*(으로|로|에|까지)?\s*(가자|가\s*줘|가\s*주세요|가고\s*싶어|안내\s*해\s*줘|안내해|안내|길\s*찾기|길\s*찾아\s*줘|찾아\s*줘|찾아)\s*$/;

/** 인식된 문장 → 명령 */
export function parseCommand(raw: string): VoiceCommand {
  const text = raw.trim().replace(/[.?!,]/g, "");
  const t = text.replace(/\s+/g, " ");

  if (/(살려|도와\s*줘|구조|119|에스오에스|sos)/i.test(t))
    return { type: "sos" };

  if (/주차/.test(t)) {
    if (/(저장|기억|여기|세웠|대\s*놨)/.test(t)) return { type: "parkSave" };
    return { type: "parkGo" };
  }

  if (/(길\s*)?안내.*(그만|종료|꺼|취소|중지|끝)|내비.*(그만|꺼|종료)/.test(t))
    return { type: "stopNav" };
  if (/주행.*(종료|끝|그만|마쳐|마칠)/.test(t)) return { type: "endRide" };
  if (/(주행.*(시작|출발)|^출발)/.test(t)) return { type: "startRide" };

  if (/배터리|충전|잔량/.test(t)) return { type: "battery" };
  if (/날씨|비\s*(와|올|오)|바람/.test(t)) return { type: "weather" };
  if (/(도착|남은\s*거리|얼마나\s*남|몇\s*시|언제)/.test(t))
    return { type: "eta" };
  if (/(속도|시속|몇\s*킬로)/.test(t)) return { type: "speed" };

  if (
    /^(우리\s*)?집(으로|에|까지)?(\s|$)/.test(t) ||
    /집\s*(으로|에)\s*(가|안내)/.test(t)
  )
    return { type: "home" };
  if (/(회사|직장)/.test(t)) return { type: "work" };

  for (const [re, kind] of NEARBY_WORDS) {
    if (
      re.test(t) &&
      (/(찾|어디|근처|가까운|가자|가\s*줘|있어)/.test(t) || t.length <= 8)
    ) {
      return { type: "nearby", kind };
    }
  }

  const m = t.match(GO_SUFFIX);
  if (m && m.index !== undefined && m.index > 0) {
    const query = t.slice(0, m.index).trim();
    if (query) return { type: "go", query };
  }
  return { type: "unknown", text };
}

// ───────────── 음성 인식 ─────────────

type RecognitionResult = { transcript: string };
type RecognitionEvent = { results: ArrayLike<ArrayLike<RecognitionResult>> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isVoiceCommandSupported = () => recognitionCtor() !== null;

/**
 * 한 번 듣고 결과(후보 문장들)를 돌려줌. 사용자 터치 안에서 호출해야 함.
 * @returns 인식 후보 문장 (가장 그럴듯한 순), 아무것도 못 들으면 []
 */
export function listenOnce(): {
  promise: Promise<string[]>;
  cancel: () => void;
} {
  const Ctor = recognitionCtor();
  if (!Ctor)
    return {
      promise: Promise.reject(new Error("unsupported")),
      cancel: () => {},
    };
  const rec = new Ctor();
  rec.lang = "ko-KR";
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 3;
  let done = false;
  const promise = new Promise<string[]>((resolve, reject) => {
    rec.onresult = (e) => {
      done = true;
      const first = e.results[0];
      const alts: string[] = [];
      for (let i = 0; i < (first?.length ?? 0); i++)
        alts.push(first[i].transcript);
      resolve(alts);
    };
    rec.onerror = (e) => {
      done = true;
      if (e.error === "no-speech" || e.error === "aborted") resolve([]);
      else reject(new Error(e.error));
    };
    rec.onend = () => {
      if (!done) resolve([]);
    };
  });
  rec.start();
  return { promise, cancel: () => rec.abort() };
}
