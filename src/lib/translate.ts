const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "gemma3:4b";

const LANG_NAMES: Record<string, string> = {
  ja: "Japanese",
  ko: "Korean",
  en: "English",
  ch_sim: "Chinese (Simplified)",
  ch_tra: "Chinese (Traditional)",
};

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const sourceName = LANG_NAMES[sourceLang] ?? sourceLang;
  const targetName = LANG_NAMES[targetLang] ?? targetLang;

  const prompt = `Translate the following ${sourceName} text to ${targetName}.
- This text is from a comic/manga speech bubble, so keep the tone natural and concise.
- If the text contains mixed languages (e.g., ${sourceName} + English), translate the ${sourceName} part and keep or appropriately adapt the English part.
- Preserve special characters, punctuation, numbers, and formatting.
- Output ONLY the translated text, with no explanation, quotes, or extra commentary.

Text: ${text}`;

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return (data.response as string).trim();
}
