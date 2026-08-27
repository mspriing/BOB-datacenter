/**
 * Tells MapLibre where its worker is.
 *
 * MapLibre 6 ships the worker as a second file and works out where to fetch it
 * from at run time, by reading import.meta.url and looking for a sibling named
 * maplibre-gl-worker.mjs. A bundler cannot see that reference, so the file was
 * never emitted and the request 404ed. The map drew its background and its
 * controls and then sat there: a GeoJSON source is parsed in the worker, so
 * with no worker the parcels never rendered, on the parcel map and on the
 * region map both.
 *
 * Vite's ?worker&url builds the worker with its dependencies folded in and
 * hands back the URL it emitted, which is what setWorkerUrl wants.
 *
 * Imported for its side effect, and imported before any map is constructed.
 */
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
