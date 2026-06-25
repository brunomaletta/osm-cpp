import { describe, expect, test } from 'vitest'
import { buildOverpassQuery } from './osm'
import { fetchRegionFromPointSet } from './geo'

describe('overpass queries', () => {
  const bounds = {
    south: -19.94,
    west: -43.95,
    north: -19.92,
    east: -43.93,
  }

  test('pedestrian query uses one filter and out geom', () => {
    const query = buildOverpassQuery(bounds, 'pedestrian')
    expect(query).toContain('out geom')
    expect(query).not.toContain('out body')
    expect(query).not.toContain('out skel')
    const wayLines = query.split('\n').filter((line) => line.trimStart().startsWith('way['))
    expect(wayLines).toHaveLength(1)
  })

  test('car query uses one filter and out geom', () => {
    const query = buildOverpassQuery(bounds, 'car')
    expect(query).toContain('out geom')
    const wayLines = query.split('\n').filter((line) => line.trimStart().startsWith('way['))
    expect(wayLines).toHaveLength(1)
  })

  test('hull region uses poly filter', () => {
    const region = fetchRegionFromPointSet([
      { lat: -19.92, lon: -43.94 },
      { lat: -19.92, lon: -43.935 },
      { lat: -19.927, lon: -43.9375 },
    ], 350)
    expect(region.polygon).toBeDefined()
    const query = buildOverpassQuery(region, 'pedestrian')
    expect(query).toContain('(poly:"')
    expect(query).not.toContain('(-19.94,-43.95')
  })
})
