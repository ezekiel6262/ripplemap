import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const envText = await fs.readFile(path.join(root, ".env.local"), "utf8");
const keyLine = envText.split(/\r?\n/).find(line => line.startsWith("OPENAI_API_KEY="));
const apiKey = keyLine?.slice("OPENAI_API_KEY=".length).trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is missing from .env.local");

const input = await fs.readFile(path.join(root, "demo", "narration.txt"), "utf8");
const response = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "gpt-4o-mini-tts",
    voice: "marin",
    input,
    instructions: "Speak in a calm, assured, polished product-demo style. Use a natural international English accent, clear diction, medium pace around 130 words per minute, and brief pauses between paragraphs. Sound credible and thoughtful, never salesy or exaggerated.",
    response_format: "mp3"
  })
});

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`Speech generation failed with status ${response.status}: ${detail.slice(0, 500)}`);
}

const output = path.join(root, "demo", "ripplemap-demo-voiceover.mp3");
await fs.writeFile(output, Buffer.from(await response.arrayBuffer()));
console.log(output);
