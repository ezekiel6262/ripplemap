export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const gemini=Boolean(process.env.GEMINI_API_KEY);
  const cloud=Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL)&&(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
  return res.status(gemini ? 200 : 503).json({
    status: gemini ? "ok" : "degraded",
    services: { bitget: "client-live", gdelt: "server-live", gemini: gemini ? "configured" : "missing", cloud: cloud ? "configured" : "local-only" },
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    timestamp: new Date().toISOString()
  });
}
