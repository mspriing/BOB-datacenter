import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MlMap, StyleSpecification, ErrorEvent } from 'maplibre-gl'
import { Minus, Plus } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { quantileScale, rampColor, NO_DATA } from '../../lib/ramp'
import { cssColor } from '../../lib/theme'
import { useReducedMotion } from '../../lib/useReducedMotion'
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
 * If the basemap host is unreachable the map must still work. Parcels are the
 * content, the basemap is context. This fallback draws them on plain ground
 * rather than showing an empty pane.
 */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#F3F5F9' } }],
}

const SHAPES = 'parcel-shapes'
const POINTS = 'parcel-points'
const LYR_FILL = 'parcel-fill'
const LYR_LINE = 'parcel-line'
const LYR_DOTS = 'parcel-dots'
const LYR_SEL_HALO = 'parcel-selected-halo'
const LYR_SEL = 'parcel-selected'

/**
 * Zoom band over which the far view hands over to the near view.
 *
 * Bexar County is about 3,200 square kilometres and the parcels here start at
 * 25 acres, so with the whole county in frame a plot is a fraction of a pixel
 * and drawing its outline would draw nothing. Dots carry the far view. As the
 * reader comes in, the dots fade out and the real shapes take over, which is
 * the point: a 25 acre square and a 25 acre roadside ribbon cost the same to
 * buy here and build very differently.
 */
const HANDOVER = [9.2, 10.8] as const

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
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    parcelId: string
    acres: string
    driver: string
  } | null>(null)
  const reduced = useReducedMotion()
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Color every parcel up front. Doing this in JS rather than a MapLibre
  // expression keeps the quantile logic identical to the state map's.
  const { shapes, points, bounds } = useMemo(() => {
    const values = parcels
      .map(p => p[shade] as number | null)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const scale = quantileScale(values, true)
    const shadeDef = PARCEL_SHADE.find(driver => driver.key === shade)!
    const colorOf = (p: ParcelSummary) => {
      const v = p[shade] as number | null
      return typeof v === 'number' && Number.isFinite(v) ? rampColor(scale(v)) : NO_DATA
    }
    const propertiesOf = (p: ParcelSummary) => {
      const value = p[shade] as number | null
      return {
        parcel_id: p.parcel_id,
        color: colorOf(p),
        acres: p.acres ?? 0,
        acres_label: p.acres === null ? 'Acreage unknown' : `${Math.round(p.acres)} acres`,
        shade_value: typeof value === 'number' && Number.isFinite(value)
          ? `${shadeDef.name}: ${shadeDef.fmt(value)}`
          : `${shadeDef.name}: no figure`,
      }
    }

    const shapeFeatures = parcels
      .filter(p => p.geometry !== null)
      .map(p => ({
        type: 'Feature' as const,
        id: p.parcel_id,
        geometry: p.geometry as GeoJSON.Polygon,
        properties: propertiesOf(p),
      }))

    const pointFeatures = parcels
      .filter(p => p.lng !== null && p.lat !== null)
      .map(p => ({
        type: 'Feature' as const,
        id: p.parcel_id,
        geometry: { type: 'Point' as const, coordinates: [p.lng as number, p.lat as number] },
        properties: propertiesOf(p),
      }))

    // The extent of the matching set, so the view can follow the filters.
    let box: [number, number, number, number] | null = null
    for (const p of parcels) {
      if (p.lng === null || p.lat === null) continue
      box = box
        ? [Math.min(box[0], p.lng), Math.min(box[1], p.lat),
           Math.max(box[2], p.lng), Math.max(box[3], p.lat)]
        : [p.lng, p.lat, p.lng, p.lat]
    }

    return {
      shapes: { type: 'FeatureCollection' as const, features: shapeFeatures },
      points: { type: 'FeatureCollection' as const, features: pointFeatures },
      bounds: box,
    }
  }, [parcels, shade])
  const dataRef = useRef({ shapes, points })
  dataRef.current = { shapes, points }

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

    m.scrollZoom.setWheelZoomRate(1 / 900)
    m.scrollZoom.setZoomRate(1 / 140)

    const check = () => { if (!m.getLayer(LYR_FILL)) setStyleEpoch(e => e + 1) }

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

  // ── Build layers only when a style load has removed them ───────────────────
  useEffect(() => {
    const m = map.current
    if (!m || !m.style || !m.isStyleLoaded()) return

    const shapeSrc = m.getSource(SHAPES) as maplibregl.GeoJSONSource | undefined
    const pointSrc = m.getSource(POINTS) as maplibregl.GeoJSONSource | undefined
    if (!shapeSrc) m.addSource(SHAPES, { type: 'geojson', data: dataRef.current.shapes })
    if (!pointSrc) m.addSource(POINTS, { type: 'geojson', data: dataRef.current.points })

    // Style events can fire between source creation and the first layer. A
    // second pass should finish the layer stack, never recreate its sources.
    if (m.getLayer(LYR_FILL)) return

    // The plot itself, shaded by the driver in the rail.
    const accent = cssColor('--blue')
    const accentWash = cssColor('--blue-x')
    m.addLayer({
      id: LYR_FILL,
      type: 'fill',
      source: SHAPES,
      paint: {
        'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false],
          accentWash, ['get', 'color']],
        // Solid enough to read the ramp, open enough to see the streets under it.
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false],
          0.78, ['interpolate', ['linear'], ['zoom'],
            HANDOVER[0], 0.4, HANDOVER[1], 0.62]],
      },
    })

    // A boundary, so neighbouring plots stay separate rather than merging into
    // one blob wherever the county subdivided a block.
    m.addLayer({
      id: LYR_LINE,
      type: 'line',
      source: SHAPES,
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false],
          accent, 'rgba(15,32,64,.55)'],
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false],
          1.8, ['interpolate', ['linear'], ['zoom'], HANDOVER[0], 0.45, 14, 1.2]],
        'line-opacity': ['interpolate', ['linear'], ['zoom'],
          HANDOVER[0], 0.55, HANDOVER[1], 0.9],
      },
    })

    // The far view. A 25 acre plot is under a pixel with the county in frame,
    // so the dots carry the map until the shapes are big enough to read.
    m.addLayer({
      id: LYR_DOTS,
      type: 'circle',
      source: POINTS,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          7,  ['interpolate', ['linear'], ['get', 'acres'], 25, 2.5, 500, 6],
          12, ['interpolate', ['linear'], ['get', 'acres'], 25, 6,   500, 20],
        ],
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 1,
        'circle-stroke-color': 'rgba(15,23,32,.45)',
        'circle-opacity': ['interpolate', ['linear'], ['zoom'],
          8, 0.12, 8.7, 0.04, HANDOVER[0], 0],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
          8, 0.16, 8.7, 0.05, HANDOVER[0], 0],
      },
    })

    m.addLayer({
      id: LYR_SEL_HALO,
      type: 'line',
      source: SHAPES,
      filter: ['==', ['get', 'parcel_id'], '__none__'],
      paint: {
        'line-color': accent,
        'line-width': 7,
        'line-blur': 3,
        'line-opacity': 0.28,
      },
    })

    // The selected plot, drawn over everything else.
    m.addLayer({
      id: LYR_SEL,
      type: 'line',
      source: SHAPES,
      filter: ['==', ['get', 'parcel_id'], '__none__'],
      paint: {
        'line-color': accent,
        'line-width': 2.5,
        'line-opacity': 1,
      },
    })

    // Layer handlers survive a style swap, so they are attached once.
    if (!wired.current) {
      wired.current = true
      let hoveredId: string | number | null = null
      const pick = (ev: maplibregl.MapLayerMouseEvent) => {
        const f = ev.features?.[0]
        if (f?.properties?.parcel_id) onSelectRef.current(String(f.properties.parcel_id))
      }
      const hover = (ev: maplibregl.MapLayerMouseEvent) => {
        const f = ev.features?.[0]
        if (!f?.properties?.parcel_id) return
        if (hoveredId !== null && hoveredId !== f.id) {
          m.setFeatureState({ source: SHAPES, id: hoveredId }, { hover: false })
        }
        hoveredId = f.id ?? String(f.properties.parcel_id)
        if (f.layer.id === LYR_FILL) {
          m.setFeatureState({ source: SHAPES, id: hoveredId }, { hover: true })
        }
        const width = holder.current?.clientWidth ?? 0
        setTooltip({
          x: Math.min(ev.point.x + 12, Math.max(8, width - 230)),
          y: Math.max(8, ev.point.y + 12),
          parcelId: String(f.properties.parcel_id),
          acres: String(f.properties.acres_label),
          driver: String(f.properties.shade_value),
        })
      }
      const leave = () => {
        if (hoveredId !== null && m.getSource(SHAPES)) {
          m.setFeatureState({ source: SHAPES, id: hoveredId }, { hover: false })
        }
        hoveredId = null
        setTooltip(null)
        m.getCanvas().style.cursor = ''
      }
      m.on('click', LYR_FILL, pick)
      m.on('click', LYR_DOTS, pick)
      for (const lyr of [LYR_FILL, LYR_DOTS]) {
        m.on('mouseenter', lyr, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mousemove', lyr, hover)
        m.on('mouseleave', lyr, leave)
      }
    }
  }, [styleEpoch])

  // Data changes update the existing sources without rebuilding layers.
  useEffect(() => {
    const m = map.current
    if (!m || !m.isStyleLoaded()) return
    const shapeSrc = m.getSource(SHAPES) as maplibregl.GeoJSONSource | undefined
    const pointSrc = m.getSource(POINTS) as maplibregl.GeoJSONSource | undefined
    shapeSrc?.setData(shapes)
    pointSrc?.setData(points)
  }, [shapes, points, styleEpoch])

  // ── Follow the filters ──────────────────────────────────────────────────────
  //
  // The view moves to the set that matched. This is the one piece of motion on
  // the map and it earns its place: narrowing to parcels within a kilometre of
  // transmission is a geographic statement, and watching the frame close on
  // that band says it faster than the count does.
  const lastFit = useRef<string>('')
  useEffect(() => {
    const m = map.current
    if (!m || !bounds || !m.isStyleLoaded()) return
    const key = bounds.map(n => n.toFixed(3)).join(',')
    if (key === lastFit.current) return
    lastFit.current = key
    const [w, s, e, n] = bounds
    // A single parcel has no extent to fit, so give it a frame to sit in.
    const pad = w === e && s === n ? 0.01 : 0
    m.fitBounds([[w - pad, s - pad], [e + pad, n + pad]], {
      padding: 44,
      maxZoom: 13.5,
      duration: reduced ? 0 : 700,
    })
  }, [bounds, styleEpoch, reduced])

  // ── Highlight the selection ─────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current
    if (!m || !m.getLayer(LYR_SEL) || !m.getLayer(LYR_SEL_HALO)) return
    const filter: maplibregl.FilterSpecification =
      ['==', ['get', 'parcel_id'], selectedId ?? '__none__']
    m.setFilter(LYR_SEL_HALO, filter)
    m.setFilter(LYR_SEL, filter)
  }, [selectedId, styleEpoch])

  const zoomBy = useCallback((delta: number) => {
    const m = map.current
    if (!m) return
    m.easeTo({ zoom: m.getZoom() + delta, duration: reduced ? 0 : 300 })
  }, [reduced])

  return (
    <div className={`relative ${className}`}>
      <div ref={holder} className="h-full w-full overflow-hidden rounded-[11px] border border-line" />
      <div className="absolute right-2 top-2 z-10 overflow-hidden rounded-[8px] border border-line bg-white shadow-[var(--shadow-sm)]">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}
          className="flex h-9 w-9 items-center justify-center text-ink2 transition-colors hover:bg-card2">
          <Plus size={17} strokeWidth={2.2} aria-hidden />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}
          className="flex h-9 w-9 items-center justify-center border-t border-line text-ink2 transition-colors hover:bg-card2">
          <Minus size={17} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
      {tooltip && (
        <div className="pointer-events-none absolute z-20 w-[218px] rounded-[9px] border border-line
          bg-white/95 px-3 py-2 shadow-[var(--shadow-md)]"
          style={{ left: tooltip.x, top: tooltip.y }}>
          <p className="truncate text-[12.5px] font-semibold text-ink">{tooltip.parcelId}</p>
          <p className="mt-0.5 text-[12px] text-mid">{tooltip.acres}</p>
          <p className="text-[12px] text-mid">{tooltip.driver}</p>
        </div>
      )}
      {basemapFailed && (
        <p className="absolute bottom-2 left-2 rounded-[7px] bg-white/90 px-2 py-1 text-[12px] text-mid">
          Streets and place names are unavailable here. The parcels are the real shapes.
        </p>
      )}
    </div>
  )
}
