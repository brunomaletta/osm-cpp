import { describe, expect, test } from 'vitest'
import {
  approxBoundsAreaSqMeters,
  approxPolygonAreaSqMeters,
  boundsFromCenter,
  bufferConvexPolygon,
  convexHull,
  fetchRegionFromPointSet,
  padBounds,
  boundsFromPoints,
  shouldPreferPatchBridgeLoad,
  pointSetSpanMeters,
  isElongatedPointSet,
  describeFetchRegionArea,
} from './geo'

describe('convex hull fetch regions', () => {
  test('collinear points use a thin corridor bbox', () => {
    const points = [
      { lat: -19.92, lon: -43.94 },
      { lat: -19.921, lon: -43.939 },
      { lat: -19.922, lon: -43.938 },
      { lat: -19.923, lon: -43.937 },
    ]
    const region = fetchRegionFromPointSet(points, 350)
    expect(region.polygon).toBeUndefined()
    expect(region.bounds.north - region.bounds.south).toBeLessThan(0.02)
  })

  test('triangle layout uses hull when bbox corners waste area', () => {
    const points = [
      { lat: -19.92, lon: -43.94 },
      { lat: -19.92, lon: -43.935 },
      { lat: -19.927, lon: -43.9375 },
    ]
    const region = fetchRegionFromPointSet(points, 350)
    expect(region.polygon?.length).toBeGreaterThanOrEqual(3)
  })

  test('spread layout uses hull when span is moderate', () => {
    const points = [
      { lat: -19.92, lon: -43.94 },
      { lat: -19.92, lon: -43.935 },
      { lat: -19.927, lon: -43.9375 },
    ]
    expect(pointSetSpanMeters(points)).toBeLessThanOrEqual(1000)
    const region = fetchRegionFromPointSet(points, 350)
    expect(region.polygon?.length).toBeGreaterThanOrEqual(3)
  })

  test('axis-aligned square stays on bbox when hull saves little', () => {
    const points = [
      { lat: -19.92, lon: -43.94 },
      { lat: -19.92, lon: -43.935 },
      { lat: -19.925, lon: -43.935 },
      { lat: -19.925, lon: -43.94 },
    ]
    const region = fetchRegionFromPointSet(points, 350)
    expect(region.polygon).toBeUndefined()
  })

  test('spread collinear layout prefers patch-bridge strategy', () => {
    const points = [
      { lat: -20.088, lon: -43.984 },
      { lat: -20.095, lon: -43.9842 },
      { lat: -20.103, lon: -43.984 },
    ]
    expect(shouldPreferPatchBridgeLoad(points)).toBe(true)
    const region = fetchRegionFromPointSet(points, 350)
    expect(region.polygon).toBeUndefined()
    const giant = padBounds(boundsFromPoints(points), 950)
    expect(approxBoundsAreaSqMeters(region.bounds)).toBeLessThan(approxBoundsAreaSqMeters(giant) * 0.4)
  })

  test('urban trapezoid spread uses bulk bbox not patch-bridge', () => {
    const points = [
      { lat: -19.923, lon: -43.943 },
      { lat: -19.934, lon: -43.951 },
      { lat: -19.929, lon: -43.931 },
      { lat: -19.939, lon: -43.926 },
    ]
    expect(pointSetSpanMeters(points)).toBeGreaterThan(600)
    expect(isElongatedPointSet(points)).toBe(false)
    expect(shouldPreferPatchBridgeLoad(points)).toBe(false)
    const region = fetchRegionFromPointSet(points, 350)
    expect(region.polygon).toBeUndefined()
  })

  test('describeFetchRegionArea formats bbox area in km²', () => {
    const region = fetchRegionFromPointSet([
      { lat: -19.92, lon: -43.94 },
      { lat: -19.918, lon: -43.938 },
    ], 350)
    expect(describeFetchRegionArea(region)).toMatch(/km²/)
    expect(describeFetchRegionArea(region)).not.toMatch(/ha/)
    const patch = { bounds: boundsFromCenter({ lat: -20.09, lon: -43.98 }, 350) }
    expect(describeFetchRegionArea(patch)).toBe('0.49 km²')
  })

  test('convexHull returns extreme points in order', () => {
    const hull = convexHull([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0.2, lon: 0.2 },
    ])
    expect(hull).toHaveLength(3)
  })

  test('bufferConvexPolygon expands area', () => {
    const triangle = [
      { lat: -19.92, lon: -43.94 },
      { lat: -19.92, lon: -43.935 },
      { lat: -19.925, lon: -43.9375 },
    ]
    const buffered = bufferConvexPolygon(triangle, 100)
    expect(approxPolygonAreaSqMeters(buffered)).toBeGreaterThan(approxPolygonAreaSqMeters(triangle))
  })
})
