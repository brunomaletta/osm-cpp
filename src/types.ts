export type LatLng = {
  lat: number
  lon: number
}

export type Bounds = {
  south: number
  west: number
  north: number
  east: number
}

export type TransportProfile = 'pedestrian' | 'car'

export type GraphNode = LatLng & {
  id: number
  osmId?: number
  ele?: number
}

export type GraphEdge = {
  id: number
  u: number
  v: number
  length: number
  geometry: LatLng[]
  osmWayId?: number
  tags?: Record<string, string>
  oneWay?: boolean
  duplicated?: boolean
}

export type StreetGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  adjacency: Array<Array<{ to: number; edgeId: number; weight: number }>>
  profile: TransportProfile
}

export type RouteResult = {
  name: string
  distance: number
  path: LatLng[]
  edges: GraphEdge[]
  highlights?: GraphEdge[]
  terminals?: number[]
  terminalLocations?: LatLng[]
  stats: Record<string, string | number>
  complexity: string
  approximation: string
}

export type PointSelection = {
  id: string
  label: string
  location: LatLng
  snappedLocation: LatLng
  snappedNode: number
  snapDistance: number
}

export type SavedExperiment = {
  id: string
  name: string
  createdAt: number
  algorithm: string
  profile: TransportProfile
  inputMode?: 'polygon' | 'points'
  radius: number
  points: LatLng[]
  tspStartIndex?: number
  bounds?: Bounds
  polygon?: LatLng[]
}
