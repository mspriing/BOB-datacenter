import { useEffect, useRef, useMemo, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MlMap, StyleSpecification, ErrorEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { quantileScale, rampColor, NO_DATA } from '../../lib/ramp'
import type { ParcelSummary } from '../../lib/parcelApi'

/** The drivers a parcel map can shade by. Low is good for every one of them. */
export const PARCEL_SHADE = [
  { key: 'lifetime_cost_per_kw',   name: 'Lifetime cost',   fmt: (v: number) => '$' + Math.round(v).toLocaleString('en-US') + '/kW' },
  { key: 'land_cost_per_acre_usd', name: 'Land price',      fmt: (v: number) => '$' + Math.round(v).toLocaleString('en-US') + '/ac' },
  { key: 'capex_per_kw',           name: 'Build cost',      fmt: (v: number) => '$' + Math.round(v).toLocaleString('en-US') + '/kW' },
  { key: 'dist_to_tx_line_m',      name: 'To transmission', fmt: (v: number) => (v / 1000).toFixed(1) + ' km' },
] as const

export type ParcelShadeKey = typeof PARCEL_SHADE[number]['key']

/**
 * A no-key basemap. OpenFreeMap serves OSM-derived vector tiles without an
 * account or token, which keeps the tool free of per-tile billing and of any
 * credential that could expire mid-demo.
 */
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

/**
 * If the basemap host is unreachable the map must still work — parcels are the
 * content, the basemap is context. This fallback draws them on a plain ground
 * rather than showing an empty pane.
 */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#F3F5F9' } }],
}

const SRC = 'parcels'
const LYR = 'parcel-dots'
const LYR_SEL = 'parcel-selected'

export function ParcelMap({
  parcels, shade, selectedId, onSelect, className = '',
}: {
  parcels: ParcelSummary[]
  shade: ParcelShadeKey
  selectedId: string | null
  onSelect: (id: string) => void
  className?: string
}) {
  const holder = useRef<HTMLDivElement | null>(null)
  const map = useRef<MlMap | null>(null)
  /**
   * Bumped whenever the style finishes loading without our layers on it.
   *
   * A plain ready flag was not enough. Swapping to the fallback style wipes
   * every source and layer the map is carrying, and the flag was already true
   * by then, so nothing re-added them and the pane sat empty on exactly the
   * runs where the basemap had failed, which is when the parcels matter most.
   */
  const [styleEpoch, setStyleEpoch] = useState(0)
  const wired = useRef(false)
  /** The fallback style is swapped in once, however many errors arrive. */
  const swapped = useRef(false)
  const [basemapFailed, setBasemapFailed] = useState(false)

  // Colour every parcel up front. Doing this in JS rather than a MapLibre
  // expression keeps the quantile logic identical to the state map's.
  const geojson = useMemo(() => {
    const values = parcels
      .map(p => p[shade] as number | null)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const scale = quantileScale(values, true)

    return {
      type: 'FeatureCollection' as const,
      features: parcels
        .filter(p => p.lng !== null && p.lat !== null)
        .map(p => {
          const v = p[shade] as number | null
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng as number, p.lat as number] },
            properties: {
              parcel_id: p.parcel_id,
              color: typeof v === 'number' && Number.isFinite(v) ? rampColor(scale(v)) : NO_DATA,
              acres: p.acres ?? 0,
            },
          }
        }),
    }
  }, [parcels, shade])

  // ── Create the map once ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!holder.current || map.current) return

    const m = new maplibregl.Map({
      container: holder.current,
      style: BASEMAP_STYLE,
      center: [-98.6, 29.45],   // Bexar County
      zoom: 8.4,
      attributionControl: { compact: true },
    })
    map.current = m

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    const check = () => { if (!m.getLayer(LYR)) setStyleEpoch(e => e + 1) }

    // A style that fails to load leaves the map blank and silent, so swap in the
    // plain ground and carry on rather than leaving the reader staring at grey.
    //
    // The swap happens once. An unreachable tile host keeps raising the same
    // error, and calling setStyle on each one wiped the parcel layer as fast as
    // it was added, which left the pane empty for the whole session.
    m.on('error', (e: ErrorEvent) => {
      const msg = String(e?.error?.message ?? '')
      if (!(msg.includes('style') || msg.includes('Failed to fetch'))) return
      setBasemapFailed(true)
      if (swapped.current) return
      swapped.current = true
      try { m.setStyle(FALLBACK_STYLE) } catch { /* already gone */ }
    })

    m.on('load', check)
    // setStyle re-fires styledata; that is where a wiped layer is noticed.
    m.on('styledata', check)
    m.on('idle', check)

    return () => { m.remove(); map.current = null }
  }, [])

  // ── Keep the source in sync ─────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current
    if (!m || !m.style || !m.isStyleLoaded()) return

    const existing = m.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (existing && m.getLayer(LYR)) { existing.setData(geojson); return }
    if (existing) m.removeSource(SRC)

    m.addSource(SRC, { type: 'geojson', data: geojson })

    m.addLayer({
      id: LYR,
      type: 'circle',
      source: SRC,
      paint: {
        // Larger parcels read as larger dots, so acreage is legible without a
        // second visual channel fighting the cost ramp.
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          7,  ['interpolate', ['linear'], ['get', 'acres'], 25, 2.5, 500, 6],
          12, ['interpolate', ['linear'], ['get', 'acres'], 25, 6,   500, 20],
        ],
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 1,
        'circle-stroke-color': 'rgba(15,23,32,.45)',
        'circle-opacity': 0.9,
      },
    })

    m.addLayer({
      id: LYR_SEL,
      type: 'circle',
      source: SRC,
      filter: ['==', ['get', 'parcel_id'], '__none__'],
      paint: {
        'circle-radius': 11,
        'circle-color': '#0F62FE',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#FFFFFF',
      },
    })

    // Layer handlers survive a style swap, so they are attached once.
    if (!wired.current) {
      wired.current = true
      m.on('click', LYR, ev => {
        const f = ev.features?.[0]
        if (f?.properties?.parcel_id) onSelect(String(f.properties.parcel_id))
      })
      m.on('mouseenter', LYR, () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', LYR, () => { m.getCanvas().style.cursor = '' })
    }
  }, [styleEpoch, geojson, onSelect])

  // ── Highlight the selection ─────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current
    if (!m || !m.getLayer(LYR_SEL)) return
    m.setFilter(LYR_SEL, ['==', ['get', 'parcel_id'], selectedId ?? '__none__'])
  }, [selectedId, styleEpoch])

  return (
    <div className={`relative ${className}`}>
      <div ref={holder} className="h-full w-full overflow-hidden rounded-[11px] border border-line" />
      {basemapFailed && (
        <p className="absolute bottom-2 left-2 rounded-[7px] bg-white/90 px-2 py-1 text-[12px] text-mid">
          Basemap unavailable. Parcels are shown without map context.
        </p>
      )}
    </div>
  )
}
