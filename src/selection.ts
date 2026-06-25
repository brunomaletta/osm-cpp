import L from 'leaflet'
import { normalizeBounds } from './geo'
import type { Bounds, LatLng } from './types'

export type RegionSelectionMode = 'radius' | 'box'

export function leafletBoundsToBounds(bounds: L.LatLngBounds): Bounds {
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  }
}

export function installHoldDragBox(map: L.Map, onSelect: (bounds: Bounds) => void): () => void {
  let start: L.LatLng | undefined
  let rectangle: L.Rectangle | undefined
  let timer: number | undefined
  let active = false

  function clearTimer() {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }

  function onMouseDown(event: L.LeafletMouseEvent) {
    if (!event.originalEvent.shiftKey) return
    start = event.latlng
    clearTimer()
    timer = window.setTimeout(() => {
      active = true
      map.dragging.disable()
      rectangle = L.rectangle(L.latLngBounds(start ?? event.latlng, event.latlng), {
        color: '#38bdf8',
        weight: 2,
        dashArray: '6 4',
        fillOpacity: 0.08,
      }).addTo(map)
    }, 180)
  }

  function onMouseMove(event: L.LeafletMouseEvent) {
    if (!active || !start || !rectangle) return
    rectangle.setBounds(L.latLngBounds(start, event.latlng))
  }

  function onMouseUp(event: L.LeafletMouseEvent) {
    clearTimer()
    if (!active || !start) {
      start = undefined
      return
    }
    const selected = normalizeBounds(toLatLng(start), toLatLng(event.latlng))
    rectangle?.remove()
    rectangle = undefined
    active = false
    start = undefined
    map.dragging.enable()
    onSelect(selected)
  }

  map.on('mousedown', onMouseDown)
  map.on('mousemove', onMouseMove)
  map.on('mouseup', onMouseUp)

  return () => {
    clearTimer()
    rectangle?.remove()
    map.dragging.enable()
    map.off('mousedown', onMouseDown)
    map.off('mousemove', onMouseMove)
    map.off('mouseup', onMouseUp)
  }
}

function toLatLng(point: L.LatLng): LatLng {
  return { lat: point.lat, lon: point.lng }
}
