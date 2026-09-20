export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  return res.status(process.env.GEMINI_API_KEY ? 200 : 503).json({
    status: process.env.GEMINI_API_KEY ? "ok" : "degraded",
    services: { bitget: "client-live", gdelt: "server-live", gemini: process.env.GEMINI_API_KEY ? "configured" : "missing" },
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    timestamp: new Date().toISOString()
  });
}
