# Compliance check

This document records what was checked before the repository went public, what
was found, and what remains open. It is a point-in-time record; the date of the
check is given for each section.

**Date of check:** 2026-07-31

---

## 1. Dependency licence scan

**Scope:** all packages in `backend/node_modules` and `frontend/node_modules` at
depth ≤ 2 (direct and first-level transitive dependencies), read from each
package's own `package.json` `license` field.

**Method:** PowerShell script scanning `node_modules/**/package.json` (excluding
nested `node_modules`) for the `license` field. Two separate scans: one for
GPL/LGPL/AGPL (copyleft), one for the full inventory.

### 1.1 Copyleft scan result

```
grep -i "GPL|LGPL|AGPL|Copyleft" across all backend and frontend node_modules:

Backend:  0 matches
Frontend: 0 matches
```

**No GPL, LGPL, or AGPL dependency found in either package tree.**

### 1.2 Licences found — backend

All packages MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, or ISC.

One package of note: `dotenv@16.6.1` is **BSD-2-Clause**, not MIT. BSD-2-Clause
is a permissive licence with no copyleft effect; it requires only attribution in
documentation. No action required.

Several `xlsx`-ecosystem packages (`adler-32`, `cfb`, `codepage`, `crc-32`,
`frac`, `human-signals`, `ssf`, `wmf`, `word`, `xlsx` itself) are
**Apache-2.0**. Consistent with the project's own licence.

Full inventory:

| Package | Version | Licence |
|---|---|---|
| @esbuild/win32-x64 | 0.28.1 | MIT |
| @jest/schemas | 29.6.3 | MIT |
| @jridgewell/sourcemap-codec | 1.5.5 | MIT |
| @rollup/rollup-win32-x64-gnu | 4.62.2 | MIT |
| @rollup/rollup-win32-x64-msvc | 4.62.2 | MIT |
| @sinclair/typebox | 0.27.12 | MIT |
| @types/body-parser | 1.19.6 | MIT |
| @types/connect | 3.4.38 | MIT |
| @types/cors | 2.8.19 | MIT |
| @types/estree | 1.0.9 | MIT |
| @types/express | 4.17.25 | MIT |
| @types/express-serve-static-core | 4.19.9 | MIT |
| @types/http-errors | 2.0.5 | MIT |
| @types/mime | 1.3.5 | MIT |
| @types/node | 20.19.43 | MIT |
| @types/qs | 6.15.1 | MIT |
| @types/range-parser | 1.2.7 | MIT |
| @types/send | 1.2.1 | MIT |
| @types/serve-static | 1.15.10 | MIT |
| @types/uuid | 10.0.0 | MIT |
| @vitest/expect | 1.6.1 | MIT |
| @vitest/runner | 1.6.1 | MIT |
| @vitest/snapshot | 1.6.1 | MIT |
| @vitest/spy | 1.6.1 | MIT |
| @vitest/utils | 1.6.1 | MIT |
| accepts | 1.3.8 | MIT |
| acorn | 8.17.0 | MIT |
| acorn-walk | 8.3.5 | MIT |
| adler-32 | 1.3.1 | Apache-2.0 |
| adm-zip | 0.6.0 | MIT |
| ansi-styles | 5.2.0 | MIT |
| array-flatten | 1.1.1 | MIT |
| assertion-error | 1.1.0 | MIT |
| body-parser | 1.20.6 | MIT |
| bytes | 3.1.2 | MIT |
| cac | 6.7.14 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| cfb | 1.2.2 | Apache-2.0 |
| chai | 4.5.0 | MIT |
| check-error | 1.0.3 | MIT |
| codepage | 1.15.0 | Apache-2.0 |
| confbox | 0.1.8 | MIT |
| content-disposition | 0.5.4 | MIT |
| content-type | 1.0.5 | MIT |
| cookie | 0.7.2 | MIT |
| cookie-signature | 1.0.7 | MIT |
| cors | 2.8.6 | MIT |
| crc-32 | 1.2.2 | Apache-2.0 |
| cross-spawn | 7.0.6 | MIT |
| debug | 2.6.9 | MIT |
| deep-eql | 4.1.4 | MIT |
| depd | 2.0.0 | MIT |
| destroy | 1.2.0 | MIT |
| diff-sequences | 29.6.3 | MIT |
| dotenv | 16.6.1 | BSD-2-Clause |
| dunder-proto | 1.0.1 | MIT |
| ee-first | 1.1.1 | MIT |
| encodeurl | 2.0.0 | MIT |
| esbuild | 0.28.1 | MIT |
| escape-html | 1.0.3 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| estree-walker | 3.0.3 | MIT |
| etag | 1.8.1 | MIT |
| execa | 8.0.1 | MIT |
| express | 4.22.2 | MIT |
| finalhandler | 1.3.2 | MIT |
| forwarded | 0.2.0 | MIT |
| frac | 1.1.2 | Apache-2.0 |
| fresh | 0.5.2 | MIT |
| function-bind | 1.1.2 | MIT |
| get-func-name | 2.0.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| get-stream | 8.0.1 | MIT |
| gopd | 1.2.0 | MIT |
| hasown | 2.0.4 | MIT |
| has-symbols | 1.1.0 | MIT |
| http-errors | 2.0.1 | MIT |
| human-signals | 5.0.0 | Apache-2.0 |
| iconv-lite | 0.4.24 | MIT |
| inherits | 2.0.4 | ISC |
| ipaddr.js | 1.9.1 | MIT |
| isexe | 2.0.0 | ISC |
| is-stream | 3.0.0 | MIT |
| js-tokens | 9.0.1 | MIT |
| local-pkg | 0.5.1 | MIT |
| loupe | 2.3.7 | MIT |
| magic-string | 0.30.21 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| media-typer | 0.3.0 | MIT |
| merge-descriptors | 1.0.3 | MIT |
| merge-stream | 2.0.0 | MIT |
| methods | 1.1.2 | MIT |
| mime | 1.6.0 | MIT |
| mime-db | 1.52.0 | MIT |
| mime-types | 2.1.35 | MIT |
| mimic-fn | 4.0.0 | MIT |
| mlly | 1.8.2 | MIT |
| ms | 2.0.0 | MIT |
| nanoid | 3.3.16 | MIT |
| negotiator | 0.6.3 | MIT |
| npm-run-path | 5.3.0 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.13.4 | MIT |
| onetime | 6.0.0 | MIT |
| on-finished | 2.4.1 | MIT |
| parseurl | 1.3.3 | MIT |
| pathe | 1.1.2 | MIT |
| path-key | 3.1.1 | MIT |
| path-to-regexp | 0.1.13 | MIT |
| pathval | 1.1.1 | MIT |
| picocolors | 1.1.1 | ISC |
| pkg-types | 1.3.1 | MIT |
| p-limit | 5.0.0 | MIT |
| postcss | 8.5.21 | MIT |
| pretty-format | 29.7.0 | MIT |
| proxy-addr | 2.0.7 | MIT |
| qs | 6.15.3 | BSD-3-Clause |
| range-parser | 1.2.1 | MIT |
| raw-body | 2.5.3 | MIT |
| react-is | 18.3.1 | MIT |
| rollup | 4.62.2 | MIT |
| safe-buffer | 5.2.1 | MIT |
| safer-buffer | 2.1.2 | MIT |
| send | 0.19.2 | MIT |
| serve-static | 1.16.3 | MIT |
| setprototypeof | 1.2.0 | ISC |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| siginfo | 2.0.0 | ISC |
| signal-exit | 4.1.0 | ISC |
| source-map-js | 1.2.1 | BSD-3-Clause |
| ssf | 0.11.2 | Apache-2.0 |
| stackback | 0.0.2 | MIT |
| statuses | 2.0.2 | MIT |
| std-env | 3.10.0 | MIT |
| strip-final-newline | 3.0.0 | MIT |
| strip-literal | 2.1.1 | MIT |
| tinybench | 2.9.0 | MIT |
| tinypool | 0.8.4 | MIT |
| tinyspy | 2.2.1 | MIT |
| toidentifier | 1.0.1 | MIT |
| tsx | 4.23.1 | MIT |
| type-detect | 4.1.0 | MIT |
| type-is | 1.6.18 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| ufo | 1.6.4 | MIT |
| undici-types | 6.21.0 | MIT |
| unpipe | 1.0.0 | MIT |
| utils-merge | 1.0.1 | MIT |
| uuid | 10.0.0 | MIT |
| vary | 1.1.2 | MIT |
| vite | 5.4.21 | MIT |
| vite-node | 1.6.1 | MIT |
| vitest | 1.6.1 | MIT |
| which | 2.0.2 | ISC |
| why-is-node-running | 2.3.0 | MIT |
| wmf | 1.0.2 | Apache-2.0 |
| word | 0.3.0 | Apache-2.0 |
| xlsx | 0.18.5 | Apache-2.0 |
| yocto-queue | 1.2.2 | MIT |
| zod | 3.25.76 | MIT |

### 1.3 Licences found — frontend

All packages MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, or CC-BY-4.0.

One package of note: `caniuse-lite@1.0.30001806` carries **CC BY 4.0**. This is
a database of browser feature support derived from Can I Use
(<https://caniuse.com/>). CC BY 4.0 requires attribution; the Can I Use project
is credited at <https://caniuse.com/about>. The package is a build-time devDependency
used by Tailwind/PostCSS for autoprefixing; it does not ship in the built
frontend bundle. No user-facing attribution is required beyond this record.

No GPL, LGPL, or AGPL found.

Full inventory:

| Package | Version | Licence |
|---|---|---|
| @babel/core (and helpers) | 7.29.7 | MIT |
| @esbuild/win32-x64 | 0.21.5 | MIT |
| @jridgewell/* | various | MIT |
| @nodelib/fs.* | 2.x | MIT |
| @rolldown/pluginutils | 1.0.0-beta.27 | MIT |
| @rollup/rollup-win32-x64-* | 4.62.2 | MIT |
| @types/d3-* | various | MIT |
| @types/react, @types/react-dom | 18.x | MIT |
| @vitejs/plugin-react | 4.7.0 | MIT |
| autoprefixer | 10.5.4 | MIT |
| browserslist | 4.28.6 | MIT |
| **caniuse-lite** | **1.0.30001806** | **CC-BY-4.0** |
| clsx | 2.1.1 | MIT |
| d3-* | various | ISC / BSD-3-Clause |
| decimal.js-light | 2.5.1 | MIT |
| esbuild | 0.21.5 | MIT |
| eventemitter3 | 4.0.7 | MIT |
| fast-equals | 5.4.1 | MIT |
| fast-glob | 3.3.3 | MIT |
| fraction.js | 5.3.4 | MIT |
| lodash | 4.18.1 | MIT |
| postcss | 8.5.19 | MIT |
| postcss-* | various | MIT |
| prop-types | 15.8.1 | MIT |
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| react-smooth | 4.0.4 | MIT |
| react-transition-group | 4.4.5 | BSD-3-Clause |
| recharts | 2.15.4 | MIT |
| rollup | 4.62.2 | MIT |
| tailwindcss | 3.4.19 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| victory-vendor | 36.9.2 | MIT AND ISC |
| vite | 5.4.21 | MIT |

---

## 2. Secrets and credential audit

**Date checked:** 2026-07-31

### 2.1 Repository files (excluding node_modules, dist, .git)

Scanned using a regex pattern covering common credential shapes
(`AKIA`, `sk-`, `ghp_`, `api_key\s*=\s*[a-zA-Z0-9]`, `password\s*=\s*`,
`secret\s*=\s*`).

**Findings:**

| File | Line | Finding | Verdict |
|---|---|---|---|
| `.env.example` | 1 | `WATSONX_API_KEY=your_ibm_cloud_api_key_here` | ✅ Placeholder only. No real key. |
| `data/regions.json` | multiple | `api_key=KEY` in EIA source URLs | ✅ Literal placeholder string `KEY`, not a real credential. |
| `data/manual-drivers.csv` | — | Same EIA URL pattern | ✅ Same placeholder. |
| `backend/src/scripts/ingest.ts` | 199 | Same EIA URL pattern | ✅ Same placeholder. |
| `scripts/ingest.ts` | 169 | Same EIA URL pattern | ✅ Same placeholder. |

**No real API key, token, password, or secret found in any tracked file.**

### 2.2 Git history

Checked for any `.env` file ever committed:

```
git log --all --diff-filter=A --name-only -- '*.env' '*.env*'
```

Result: Only `.env.example` (the template, not the secret) was ever committed,
in the foundation commit `9b63f285`. No `.env` with real credentials was ever
committed.

### 2.3 .bob/ LLM cache

```
git log --all --diff-filter=A --name-only -- '.bob/*'
```

Result: **No output.** Nothing under `.bob/` was ever committed. The directory
is listed in `.gitignore` and is untracked.

### 2.4 .DS_Store files

```
git ls-files frontend/.DS_Store
git ls-files .DS_Store
```

Result: **No output.** No `.DS_Store` file is tracked. `.DS_Store` appears on
line 1 of `.gitignore` and applies to the whole tree.

### 2.5 Client-side secret exposure

The frontend is a static React SPA. It communicates with the backend via a single
configurable URL (`VITE_API_URL`), which is injected at build time by Vite and is
not a secret (it is the public backend URL). No API keys, watsonx credentials, or
EIA keys are referenced in any file under `frontend/src/`. The backend holds
credentials in environment variables loaded at startup; they are never serialised
into the API response. Confirmed by inspection of:

- `frontend/src/config.ts` — reads only `VITE_API_URL`
- `backend/src/llm/watsonx.ts` — reads `WATSONX_*` env vars server-side only
- `GET /health` response — returns `{ status: "ok" }` only

---

## 3. Fonts and icons

### 3.1 Fonts

IBM Plex Sans and IBM Plex Mono are loaded at runtime via Google Fonts CDN.
No font files are bundled in the repository. Both are licensed under the
SIL Open Font License 1.1. Attribution is carried in the NOTICE file.

The OFL prohibits selling the fonts on their own. This project does not do that.
The OFL does not require per-page attribution in a web application.

### 3.2 Icons

No icon library is used. Medal emoji (🥇🥈🥉) are Unicode codepoints rendered by
the OS emoji font. No third-party icon licence obligation.

### 3.3 Images

All images in `docs/bob/` are project-author screenshots. No third-party images.

---

## 4. Open items

| # | Item | Risk | Owner action required |
|---|---|---|---|
| 1 | `caniuse-lite` CC BY 4.0 | Low — build-time only, does not ship to users | No user-facing action required. This record serves as attribution. |
| 2 | LBNL explicit licence statement | Low — DOE-funded public release | None. Cited with attribution. |
| 3 | Thames Water wholesale proxy | Documented | Noted `basis: modeled` in `manual-drivers.csv`. |
| 4 | Mumbai MCGM 2026 tariff | Documented | Could not access official 2026 tariff. Noted `basis: modeled`. Rate should be refreshed if the project is used commercially. |
| 5 | Queretaro CEA water rate | Gap | Rate page returns HTTP 403. Value is null. No assumption made. |
| 6 | GitHub SBOM export | Recommended | Export from GitHub Insights → Dependency Graph → Export SBOM and attach to submission. Free and instant. |
| 7 | Dependabot / CodeQL | Recommended | Enable in GitHub Settings → Code security: Dependabot alerts, secret scanning with push protection, CodeQL, dependency review. |
