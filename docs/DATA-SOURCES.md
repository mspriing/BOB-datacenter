# Data sources and third-party licences

This document records every external source this project uses, derives from, or
references, together with the licence or terms under which each is used. It covers
data, fonts, and icons. Dependency licences are in `docs/COMPLIANCE-CHECK.md`.

---

## 1. Data sources

### 1.1 US federal government datasets

US federal government works are not subject to copyright under 17 U.S.C. § 105.
The three datasets below are public domain. Attribution is given as a matter of
good practice; no licence compliance obligation exists.

| Source | Used for | URL | Terms |
|---|---|---|---|
| US Energy Information Administration (EIA) — Electricity Retail Sales API | Electricity retail price per kWh by state and sector | <https://www.eia.gov/opendata/> | Public domain (federal govt work). API key required for programmatic access; key must not be committed (see `.env.example`). |
| US Bureau of Labor Statistics (BLS) — Occupational Employment and Wage Statistics | Construction and electrician wage rates by metro area | <https://www.bls.gov/oes/> | Public domain (federal govt work). |
| FEMA National Risk Index | Natural hazard composite risk scores by county | <https://hazards.fema.gov/nri/> | Public domain (federal govt work). Terms: <https://hazards.fema.gov/nri/disclaimer>. |

**Note on `api_key=KEY` in source URLs.** The EIA API URLs stored in
`data/regions.json` and `data/manual-drivers.csv` contain the literal placeholder
string `api_key=KEY`. This is intentional: the placeholder marks where a real key
goes in a live query. No real EIA key is stored in the repository.

### 1.2 Lawrence Berkeley National Laboratory (LBNL)

| Source | Used for | URL | Terms |
|---|---|---|---|
| LBNL Electricity Markets and Policy Group — Queuing Up (grid interconnection queue data) | Interconnection wait times and grid capacity margins | <https://emp.lbl.gov/queues> | Prepared under US DOE contract DE-AC02-05CH11231. Publicly released; DOE-funded research reports are generally public domain. No explicit licence stated on the download page; cited with attribution. |

### 1.3 European and international datasets

| Source | Used for | URL | Terms |
|---|---|---|---|
| Eurostat — Electricity prices for non-household consumers | European industrial electricity prices (€/kWh) | <https://ec.europa.eu/eurostat/databrowser/product/view/nrg_pc_205> | © European Union, 1995–2026. Reuse authorised under the Commission Decision of 12 December 2011 (2011/833/EU) on reuse of Commission documents, provided the source is acknowledged. Source is acknowledged in `data/regions.json` per-value `source_url` fields. |
| Energimyndigheten (Swedish Energy Agency) | Swedish electricity prices and renewable share | <https://www.energimyndigheten.se/> | Swedish public-sector information. No copyright claim on official statistics per Swedish law (Lag om vidareutnyttjande av handlingar från den offentliga förvaltningen, SFS 2010:566). Cited with attribution. |
| Our World in Data — Share of electricity from renewables | Renewable electricity percentage by country | <https://ourworldindata.org/grapher/share-electricity-renewables> | **Data files: CC BY 4.0** (<https://creativecommons.org/licenses/by/4.0/>). Charts and written content: © Our World in Data. Individual series data sourced by OWID from Ember and BP; underlying data carries its own terms (Ember: CC BY 4.0). Source acknowledged per CC BY 4.0 requirements. |
| ThinkHazard (GFDRR / World Bank) | Natural hazard risk classification (heat, flood, wind, earthquake) | <https://www.thinkhazard.org/> | **CC BY 4.0** (<https://creativecommons.org/licenses/by/4.0/>). © Global Facility for Disaster Reduction and Recovery (GFDRR). Source acknowledged. |
| PeeringDB | Network latency reference and peering exchange locations | <https://www.peeringdb.com/> | **CC BY 4.0** (<https://creativecommons.org/licenses/by/4.0/>). PeeringDB data licence: <https://www.peeringdb.com/about/legal/>. Source acknowledged. |
| ILOSTAT (ILO) | International construction wage comparisons | <https://ilostat.ilo.org/> | ILO data is publicly available for research and non-commercial use; source acknowledgment required. <https://ilostat.ilo.org/resources/methods/copyright/> |
| Azure network latency documentation | Cloud region-to-region latency figures | <https://azure.microsoft.com/en-us/explore/global-infrastructure/latency/> | © Microsoft Corporation. Small number of published figures cited with attribution for reference. No Microsoft data is redistributed in bulk. |
| WonderNetwork global ping statistics | Internet latency reference data | <https://wondernetwork.com/pings> | © WonderNetwork. Published ping data cited with attribution. |

### 1.4 Published research — cited figures only

The following sources are published research or proprietary reports. This project
quotes a small number of aggregate index figures with attribution. No table or
substantial portion of any report is reproduced.

| Source | Used for | URL | Terms |
|---|---|---|---|
| Turner & Townsend — Data Centre Construction Cost Index | Construction cost per MW benchmarks by region | <https://www.turnerandtownsend.com/en/perspectives/data-centres/data-centre-cost-index/> | © Turner & Townsend. A small number of headline index figures are cited with attribution. The full report is not reproduced. Use is consistent with normal academic and journalistic citation practice. |
| Lincoln Institute of Land Policy — 50-State Property Tax Comparison Study | Commercial property tax effective rates by state | <https://www.lincolninst.edu/publications/other/50-state-property-tax-comparison-study> | © Lincoln Institute of Land Policy. A small number of state-level effective-rate figures are cited with attribution. The full study is not reproduced. Use is consistent with normal academic citation practice. |
| NCSL — State tax treatment of data centers | State data-center tax incentive summaries | <https://www.ncsl.org/technology-and-communication/state-data-center-tax-exemptions> | © National Conference of State Legislatures. Factual legislative summaries cited with attribution. |
| Texas Comptroller of Public Accounts — data center exemption lists | Texas data center sales tax exemption qualifying sites | <https://comptroller.texas.gov/taxes/sales/data-centers.php> | Texas state government data; public domain. |

### 1.5 Utility tariff pages

Individual electricity, water, and property tax rates come from the utility tariff
pages listed in the `source_url` field of each value in `data/regions.json` and
`data/manual-drivers.csv`. There are approximately 40 distinct utility pages
across 13 markets.

**US municipal and state tariff schedules** (e.g. City of Columbus water rates,
City of Phoenix water rates, Dallas Water Utilities, SAWS, Portland Water Bureau,
MUD Omaha, Des Moines Water Works) are published by government agencies and are
public domain or freely available for public use under state open-records
frameworks. No tariff document is redistributed in full; only the specific rate
figures used in the model are stored, together with the source URL and
verification date.

**Non-US utility pages** (Uisce Éireann, Waternet, Mainova, Lulea Vattenfall,
Oslo VAV, PUB Singapore, Tokyo Metropolitan Waterworks, Thames Water, Eau de
Paris, Sabesp/ARSESP) are published by regulated utilities or government bodies
under their standard transparency obligations. Small numbers of tariff figures
are cited with attribution. No tariff document is redistributed.

**Key open item:** Thames Water's Slough wholesale price is used as a proxy for
the retail price a data center would actually pay, because non-household retail
water in England is a competitive market with no published retail tariff. This is
noted in `data/manual-drivers.csv` with `basis: modeled`. See the notes field for
detail.

---

## 2. Fonts

| Font | Used for | URL | Licence |
|---|---|---|---|
| IBM Plex Sans | UI body text | <https://github.com/IBM/plex> | **SIL Open Font License 1.1** (OFL). © IBM Corp. Full OFL text: <https://scripts.sil.org/OFL>. |
| IBM Plex Mono | Numeric data display | <https://github.com/IBM/plex> | **SIL Open Font License 1.1** (OFL). © IBM Corp. |

**Delivery method.** Both fonts are loaded at runtime via Google Fonts CDN
(`@import url('https://fonts.googleapis.com/css2?...')` in `frontend/src/index.css`).
No font files are bundled in this repository. The OFL requires that the font name
be preserved and that the font not be sold on its own; both conditions are met.
Google's serving of the fonts is covered by Google's own licence agreement with
the font authors.

**OFL NOTICE obligation.** The Apache 2.0 NOTICE file at the repo root carries the
required OFL attribution. If this project is ever packaged with font files bundled,
a copy of the OFL must be included alongside them.

---

## 3. Icons and images

No icon library (e.g. Font Awesome, Material Icons) is used in this project.
Medal emoji (🥇🥈🥉) in `frontend/src/components/RankedSiteCards.tsx` are Unicode
codepoints rendered by the operating system's emoji font; they carry no third-party
licence obligation.

All images in `docs/bob/` are screenshots taken by the project author during
development. No third-party images are included.

---

## 4. Open items

| Item | Status | Notes |
|---|---|---|
| NCSL legislative summaries | Low risk | Factual legislative information is not copyrightable in most jurisdictions; citation practice is sufficient. |
| Azure latency data | Low risk | Published marketing/documentation figures cited with attribution. Microsoft does not restrict citation of published specifications. |
| Thames Water wholesale proxy for retail | Documented | Noted `basis: modeled` in `manual-drivers.csv`; the limitation is described in the notes field. |
| Mumbai MCGM water rate | Documented | Based on a news report citing the utility; official 2026 tariff could not be accessed. Noted `basis: modeled`. |
| Queretaro CEA water rate | Gap | Rate page returns HTTP 403 to automated access. Value is null in `data/manual-drivers.csv`. No assumption made. |
| LBNL explicit licence | Low risk | DOE-funded research; no licence restriction found. Cited with attribution. |
