import { spawn } from "child_process";
import path from "path";

export type OcrRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence: number;
};

// EasyOCR로 복구
const scriptPath = path.join(process.cwd(), "scripts", "ocr_easyocr.py");

export function runOcr(imagePath: string, lang: string): Promise<OcrRegion[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python", [scriptPath, imagePath, lang]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`OCR process exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}");
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        resolve(parsed.regions ?? []);
      } catch {
        reject(new Error(`Failed to parse OCR output: ${stdout} ${stderr}`));
      }
    });
  });
}
