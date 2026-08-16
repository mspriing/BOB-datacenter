# Work order 10 — criteria parsing and per-parcel narrative

Phase 3. Read `docs/work-orders/00-parcel-product-brief.md` and `AGENTS.md` first.

Branch: `parcel/phase3-ai`. Prerequisite: work order 09 merged.

---

## Context

Two LLM features, both bounded by the standing rule: **the model never produces a number.** It turns a sentence into a filter, and it explains figures the engine computed. Nothing else.

`backend/src/llm/parseInput.ts` already does the analogous job for the region tool — free text into typed overrides, watsonx path plus deterministic fallback, hallucinated regions dropped rather than trusted. Follow its shape; do not invent a second pattern.

---

## Task 1 — schema first

Document in `docs/SCHEMA.md`:

- `POST /criteria/parse` — free text in, structured filters + weights out, with a `confidence` and an `unparsed` list naming anything in the input the parser could not turn into a filter
- The `parcel_note` field added to `ParcelEstimate`

`unparsed` is not optional. A developer typing "near water rights and cheap land" must be told which half was understood.

**Commit.** `docs(schema): criteria parsing and parcel note`

---

## Task 2 — criteria parser

Create `backend/src/llm/parseCriteria.ts` exporting `parseCriteria(text, county)`.

watsonx path with the deterministic fallback, mirroring `parseInput.ts`. The fallback is a keyword-and-number matcher — "at least 50 acres", "within 5 miles of transmission", "no flood risk" — and it must work with the model unreachable. Credentials are currently disabled, so **the fallback is the path that will be demoed.** Build it first and treat the watsonx path as the enhancement.

Validate every parsed filter against the real filter vocabulary and drop anything outside it, exactly as `parseInput.ts` drops hallucinated region keys. A filter the model invented is worse than a filter it missed: a missed one is visible in `unparsed`, an invented one silently changes the result set.

**Acceptance.** Tests covering: a sentence with three criteria yields three filters; a sentence with an unsupported criterion lists it in `unparsed` rather than dropping it silently; the fallback path produces usable filters with no credentials present.

**Commit.** `feat(llm): natural-language criteria parser`

---

## Task 3 — confirmation before applying

The parsed interpretation is shown to the user **before** it changes the result set. Filters as editable chips, `unparsed` items listed plainly, an explicit apply action.

Never silently act on a model's reading of intent. The region tool already holds this line for free-text overrides; hold it here.

**Acceptance.** Parsing alone changes nothing on screen. Only the apply action re-runs the search.

**Commit.** `feat(ui): criteria confirmation before apply`

---

## Task 4 — per-parcel narrative

Create `backend/src/llm/parcelNote.ts` exporting `parcelNote(estimate)`.

**Scope, as specified by the product owner: the note is written from the driver data and its provenance, not from the parcel's identity.** It explains which figures dominate this parcel's cost, how they compare to the county median, and how well-sourced they are. It does not describe the owner, the neighbourhood, or what a site "feels like" — the model has no basis for any of that, and inventing it would undermine every honest figure beside it.

Constraints:

- Generated **on demand for the parcel being viewed**. Never batch across the candidate set — 3,500 generations per ingest is both expensive and pointless.
- Cache by `hash(parcel_id + criteria + estimate figures)` using the existing `backend/src/llm/cache.ts`.
- Two to three sentences. It sits beside the waterfall, not in place of it.
- Every number in the prose is quoted from the `ParcelEstimate`. The deterministic fallback assembles the same sentences from the same figures.
- A parcel whose cost is dominated by an `assumed` driver must say so in the note.

**Acceptance.** A test asserts every numeric token in a generated note appears in the source estimate. Notes generate only for requested parcels — assert the generation count after a search returning 50 parcels is zero.

**Commit.** `feat(llm): per-parcel narrative grounded in driver data`

---

## Task 5 — wire the note into detail

Render the note on `ParcelDetail`, with the same source badge the region tool uses — "written by watsonx Granite" versus "written by the deterministic template". The badge is not decoration; it is how a reader knows which path produced the words.

**Acceptance.** With no credentials present the note still renders, correctly badged.

**Commit.** `feat(ui): parcel note on detail screen`

---

## Definition of done

- Criteria parsing works with credentials absent.
- No note contains a number absent from its estimate.
- Notes are generated on demand only.
- Backend suite passes; report the count.
- No cost math added to the LLM layer — verify with `git diff main -- backend/src/llm/` and confirm no arithmetic on cost figures.
