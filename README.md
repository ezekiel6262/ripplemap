# RippleMap

RippleMap is a live, evidence-disciplined cross-asset research workspace. A user enters an event or research question; RippleMap fetches current Bitget spot-market data, retrieves recent reporting indexed by GDELT, and asks Gemini to construct conditional transmission paths without presenting correlation as causation.

## Live product

- Production: https://ripplemap-three.vercel.app
- Health: https://ripplemap-three.vercel.app/api/health
- Repository: https://github.com/ezekiel6262/ripplemap

## Real data flow

```text
User research question
        |
        +--> Bitget API v3 ticker/instrument data (browser)
        |
        +--> /api/analyze --> GDELT DOC 2.0 source leads
                           --> Gemini 3.6 Flash structured analysis
        |
        +--> Evidence audit, source links, caveats and invalidation conditions
```

No market values are seeded or simulated. The event text is treated as unverified user context. Recent article titles are presented as research leads rather than verified facts.

## Production safeguards

- Gemini key is server-only in Vercel.
- Structured-output schema constrains the model response.
- Request-size limits, per-instance throttling and upstream timeouts.
- Security headers and restrictive browser permissions.
- Structured request logs and a public, non-secret health endpoint.
- Graceful degradation when GDELT is unavailable.

## Local development

The static interface lives in `dist/`; serverless functions live in `api/`.

```bash
vercel link
vercel env pull .env.local --environment=production
vercel dev
```

Required secret: `GEMINI_API_KEY`.

## Limitations

RippleMap is a research tool, not financial advice. Twenty-four-hour market movements do not establish causality, and indexed reporting can be incomplete or noisy. Users should open and verify primary sources before relying on a claim.
