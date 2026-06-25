# OSM Postman

Interactive GitHub Pages app for exploring graph algorithms on live OpenStreetMap data.

## Local Development

```sh
npm install
npm run dev
```

## Checks

```sh
npm test
npm run build
```

## Current Features

- Click a map location to fetch a pedestrian or car OSM graph around that point.
- Shift + hold + drag to select a rectangular region.
- Run Chinese Postman on the selected region.
- Add selected points and run MST, TSP, minimum weighted matching, or Steiner tree on the OSM shortest-path metric closure.
- Show algorithm complexity and approximation guarantees in the UI.
- Export displayed results as GPX or GeoJSON.

Car mode currently solves an undirected approximation of the drivable graph. One-way-aware routing is a planned upgrade.
