import { allowRequest, bodyTooLarge, fetchWithTimeout, prepare } from "./_lib/security.js";

const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    transmissionPaths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          driver: { type: "string" },
          mechanism: { type: "string" },
          affectedSymbols: { type: "array", items: { type: "string" } },
          expectedDirection: { type: "string", enum: ["positive", "negative", "mixed", "unclear"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          evidence: { type: "string" },
          invalidation: { type: "string" }
        },
        required: ["driver", "mechanism", "affectedSymbols", "expectedDirection", "confidence", "evidence", "invalidation"]
      }
    },
    contradictions: { type: "array", items: { type: "string" } },
    watchConditions: { type: "array", items: { type: "string" } },
    caveats: { type: "array", items: { type: "string" } }
  },
  required: ["summary", "transmissionPaths", "contradictions", "watchConditions", "caveats"]
};

function decodeXml(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export default async function handler(req, res) {
  const telemetry = prepare(req, res, "/api/analyze");
  const reply = (status, body, extra) => { telemetry.done(status, extra); return res.status(status).json(body); };
  if (req.method !== "POST") return reply(405, { error: "POST required" });
  if (!allowRequest(req)) return reply(429, { error: "Too many analysis requests. Try again in a minute." });
  if (bodyTooLarge(req)) return reply(413, { error: "Request is too large" });
  if (!process.env.GEMINI_API_KEY) return reply(503, { error: "Gemini is not configured" });
  const event = String(req.body?.event || "").trim().slice(0, 4000);
  const marketData = Array.isArray(req.body?.marketData) ? req.body.marketData.slice(0, 12) : [];
  if (!event || !marketData.length) return reply(400, { error: "Event and live market data are required" });
  const safeMarket = marketData.map(row => ({
    symbol: String(row.symbol || "").slice(0, 30), lastPrice: Number(row.lastPrice), price24hPcnt: Number(row.price24hPcnt),
    bid1Price: Number(row.bid1Price), ask1Price: Number(row.ask1Price), turnover24h: Number(row.turnover24h),
    sourceTimestamp: String(row.sourceTimestamp || "").slice(0, 80)
  })).filter(row => row.symbol && [row.lastPrice, row.price24hPcnt, row.bid1Price, row.ask1Price, row.turnover24h].every(Number.isFinite));
  if (!safeMarket.length) return reply(400, { error: "No valid market rows were supplied" });
  let newsSources = [];
  try {
    const query = event.replace(/[^a-zA-Z0-9\s-]/g, " ").split(/\s+/).filter(word => word.length > 2).slice(0, 10).join(" ");
    if (query) {
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=8&timespan=3days&sort=hybridrel`;
      const sourceResponse = await fetchWithTimeout(url, { headers: { "user-agent": "RippleMap/1.0 research app" } }, 8_000);
      const raw = await sourceResponse.text();
      const parsed = JSON.parse(raw);
      newsSources = (parsed.articles || []).slice(0, 8).map((article, index) => ({ index: index + 1, title: String(article.title || "").slice(0, 300), url: String(article.url || "").slice(0, 1000), domain: String(article.domain || "").slice(0, 120), seenDate: String(article.seendate || "").slice(0, 40), language: String(article.language || "").slice(0, 40) })).filter(source => source.title && /^https?:\/\//.test(source.url));
    }
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", msg: "source_fetch_failed", route: "/api/analyze", requestId: telemetry.requestId, error: error instanceof Error ? error.message : String(error) }));
  }
  if (!newsSources.length) {
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(event.slice(0, 240))}&hl=en-US&gl=US&ceid=US:en`;
      const rssResponse = await fetchWithTimeout(rssUrl, { headers: { "user-agent": "RippleMap/1.0 research app" } }, 8_000);
      const xml = await rssResponse.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8);
      newsSources = items.map((match, index) => {
        const item = match[1];
        const field = name => decodeXml(item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1] || "");
        const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);
        return { index: index + 1, title: field("title").slice(0, 300), url: field("link").slice(0, 1000), domain: decodeXml(sourceMatch?.[1] || "Google News").slice(0, 120), seenDate: field("pubDate").slice(0, 60), language: "English", indexer: "Google News RSS" };
      }).filter(source => source.title && /^https?:\/\//.test(source.url));
    } catch (error) {
      console.warn(JSON.stringify({ level: "warn", msg: "source_fallback_failed", route: "/api/analyze", requestId: telemetry.requestId, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  const prompt = `You are RippleMap, an evidence-disciplined cross-asset research assistant. Analyze a user-supplied event against a live Bitget market snapshot and recent GDELT-indexed reporting. Separate observations from inference. Never invent news, prices, correlations, historical analogues, or certainty. The event is unverified user context. Article titles are leads, not verified ground truth; attribute them by source index when relevant. Use only supplied market fields as factual market evidence. A 24h move does not prove causality. Produce research conditions, not personalized financial advice. If the news list is empty or weakly related, say so explicitly.\n\nUSER EVENT:\n${event}\n\nLIVE BITGET SNAPSHOT:\n${JSON.stringify(safeMarket)}\n\nRECENT SOURCE LEADS:\n${JSON.stringify(newsSources)}`;
  try {
    const response = await fetchWithTimeout("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseJsonSchema: schema }
      })
    });
    const payload = await response.json();
    if (!response.ok) return reply(response.status, { error: payload?.error?.message || "Gemini request failed" }, { provider: "gemini" });
    const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("");
    if (!text) return reply(502, { error: "Gemini returned no analysis" });
    return reply(200, { analysis: JSON.parse(text), sources: newsSources, marketSource: "Bitget API v3", model: "gemini-3.6-flash", generatedAt: new Date().toISOString() }, { sources: newsSources.length, rows: safeMarket.length });
  } catch (error) {
    return reply(error?.name === "AbortError" ? 504 : 500, { error: error?.name === "AbortError" ? "Analysis timed out. Please retry." : error instanceof Error ? error.message : "Analysis failed" });
  }
}
