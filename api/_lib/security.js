const buckets = new Map();

export function prepare(req, res, route) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const requestId = req.headers["x-vercel-id"] || crypto.randomUUID();
  const started = Date.now();
  console.log(JSON.stringify({ level: "info", msg: "start", route, requestId }));
  return {
    requestId,
    done(status, extra = {}) {
      console.log(JSON.stringify({ level: status >= 500 ? "error" : "info", msg: "done", route, requestId, status, ms: Date.now() - started, ...extra }));
    }
  };
}

export function allowRequest(req, limit = 12, windowMs = 60_000) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (buckets.get(ip) || []).filter(time => now - time < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  buckets.set(ip, recent);
  if (buckets.size > 5000) for (const [key, hits] of buckets) if (!hits.some(time => now - time < windowMs)) buckets.delete(key);
  return true;
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 18_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export function bodyTooLarge(req, max = 32_000) {
  const declared = Number(req.headers["content-length"] || 0);
  return declared > max || JSON.stringify(req.body || {}).length > max;
}
