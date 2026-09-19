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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "Gemini is not configured" });
  const event = String(req.body?.event || "").trim().slice(0, 4000);
  const marketData = Array.isArray(req.body?.marketData) ? req.body.marketData.slice(0, 12) : [];
  if (!event || !marketData.length) return res.status(400).json({ error: "Event and live market data are required" });
  const prompt = `You are RippleMap, an evidence-disciplined cross-asset research assistant. Analyze a user-supplied event against a live Bitget market snapshot. Separate observations from inference. Never invent news, prices, correlations, historical analogues, or certainty. The event is unverified user context. Use only supplied market fields as factual evidence. A 24h move does not prove causality. Produce research conditions, not personalized financial advice.\n\nUSER EVENT:\n${event}\n\nLIVE BITGET SNAPSHOT:\n${JSON.stringify(marketData)}`;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseJsonSchema: schema }
      })
    });
    const payload = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: payload?.error?.message || "Gemini request failed" });
    const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("");
    if (!text) return res.status(502).json({ error: "Gemini returned no analysis" });
    return res.status(200).json({ analysis: JSON.parse(text), model: "gemini-2.5-flash", generatedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Analysis failed" });
  }
}
