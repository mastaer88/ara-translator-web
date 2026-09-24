import { spawn } from "child_process";
import path from "path";

/**
 * 텍스트에서 언어를 감지합니다.
 * 반환값: "ja" | "ko" | "en" | etc.
 */
export async function detectLanguage(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", "detect_language.py");

    const child = spawn("python3", [scriptPath, text], {
      timeout: 10000,
    });

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          if (result.success) {
            resolve(result.language_code || "en");
          } else {
            console.error("Language detection error:", result.error);
            resolve("ja");
          }
        } catch (e) {
          console.error("Failed to parse language detection output:", output);
          resolve("ja");
        }
      } else {
        console.error("Language detection failed:", errorOutput);
        resolve("ja");
      }
    });

    child.on("error", (err) => {
      console.error("Language detection process error:", err);
      resolve("ja");
    });
  });
}

/**
 * 언어 코드를 한글 이름으로 변환
 */
export function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    ja: "일본어",
    ko: "한국어",
    en: "영어",
    zh: "중국어",
    es: "스페인어",
    fr: "프랑스어",
    de: "독일어",
    ru: "러시아어",
    pt: "포르투갈어",
  };
  return names[code] || code;
}

/**
 * 감지된 언어 코드를 지원하는 언어로 매핑
 * 지원하는 언어: ja (일본어), ko (한국어), en (영어)
 */
export function mapToSupportedLanguage(detectedCode: string): "ja" | "ko" | "en" {
  const map: Record<string, "ja" | "ko" | "en"> = {
    ja: "ja",
    jp: "ja",
    ko: "ko",
    kr: "ko",
    en: "en",
    us: "en",
    gb: "en",
  };

  return map[detectedCode.toLowerCase()] || "en";
}
