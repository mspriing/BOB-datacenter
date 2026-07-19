Project: Data-center site-decision copilot for the IBM AI Builders Challenge (Wildcard track: Intelligent Systems for the Future of Work).

What it does: a site-selection professional inputs 2–4 candidate data-center sites; the tool ranks them, prices the real cost drivers, and writes a defensible recommendation.

Rules:
- All cost/financial math lives in backend/ as deterministic, tested, plain code. The LLM NEVER generates numbers.
- The LLM layer (watsonx/Granite) only: parses messy input, selects cost drivers from data/regions.json, and writes the ranked narrative + sensitivity flags, citing the engine's numbers.
- Every figure in data/regions.json keeps a source_url and last_verified field.
- Input schema accepts 2–4 candidate sites. Output schema always includes: ranking, per-site itemized cost breakdown (CapEx/OpEx, fixed/variable), levelized $/kW, NPV/payback, low/base/high range, a "this ranking flips if…" sentence, and a plain-English recommendation paragraph.
- Frontend: React + Vite + Tailwind. Keep components small. No feature that isn't in docs/SCHEMA.md.