# Diagnostic Report: Mapbox GL JS + Three.js 3D EV Model Integration

## A. Executive Summary

The project's active map is **Leaflet 1.9.4**, loaded from a CDN. Mapbox is currently used only as a **raster tile source**; the app does not use Mapbox GL JS, its map instance, or its custom-layer interface. The live frontend is a vanilla JavaScript page served by Express, despite the repository also containing a Vite/React scaffold.

The route, station, and animated-vehicle coordinates are available in forms that can be adapted for a 3D vehicle. However, the supplied Mapbox example's `CustomLayerInterface` requires a Mapbox GL JS map and its WebGL context. It cannot be registered on the existing Leaflet map. Mapbox GL JS and Three.js are not installed, and no EV GLB/GLTF model is present.

**Decision: BLOCKED** for the requested Mapbox GL JS custom-layer integration while preserving the existing mapping library. If a Mapbox GL JS map migration is permitted, the data flow can be adapted, but the live map renderers and dependencies will need changes.

## B. Verified Repository Structure

Project root: `C:\Users\Mahadik\Downloads\RouteR-main\RouteR-main`

Relevant structure found:

- **Live frontend:** `index.html`, `frontend\app.js`, and `frontend\index.css`. The root HTML loads the app script from `/static/app.js`.
- **Secondary frontend page:** `frontend\index.html`. It also references Leaflet from a CDN.
- **Active Node backend:** `server.ts`. The package's `start` and `dev` scripts run this Express server.
- **React/Vite scaffold:** `src\main.tsx`, `src\App.tsx`, and `vite.config.ts`. `App.tsx` currently renders an empty `<div>`; it is not the live map application.
- **Separate Python backend code:** `backend_api\server.py`, `backend_api\models.py`, and files under `backend_core\`. The Node package scripts do not start this Python API.
- **Geographical data:** `data\`, including the station CSV inventories.
- **Static public files:** `public\`.
- **Environment template:** `.env.example`. A local ignored `.env` is used at runtime; its contents are not reproduced here.
- **Package manifest:** `package.json`. No root-level package lockfile was found.

There are no map-specific React components, hooks, contexts, or frontend API-service modules in the active frontend. The browser code calls backend endpoints directly.

## C. Dependency Compatibility Matrix

Installed versions below were checked from the local installed packages. The package manifest and runtime differ in purpose: React/Vite are installed, but the active Express-served map is not built from the React scaffold.

| Technology | Verified state | Compatibility assessment |
|---|---|---|
| React | 19.3.1 installed; manifest declares `^19.0.1` | Present, but the live map is not a React component. |
| Vite | 8.3.5 installed; manifest declares `^8.3.0` | Present and configured, but the app's `start` script runs Express/`tsx`, not Vite. |
| Leaflet | Runtime CDN URL specifies 1.9.4; not installed as a package | This is the actual map library. |
| Mapbox GL JS | Not installed | Required for the reference custom layer; currently only Mapbox raster tiles are used. |
| Three.js | Not installed | Required for the reference renderer and model scene. |
| `@types/three` | Not installed | Needed if the new renderer is authored and type-checked in TypeScript. |
| Turf.js | Not installed | Not required for the proposed model transform; no current Turf usage was found. |
| GeoJSON types/library | No directly resolvable `@types/geojson` or GeoJSON utility library found | Route geometry can be converted to GeoJSON, but the existing response is coordinate arrays rather than a GeoJSON Feature/FeatureCollection. |

Vite can bundle ES-module imports such as `three` and `GLTFLoader` once dependencies exist. However, the current static `frontend\app.js` is loaded directly by Express as a classic script; it does not currently use Vite module imports. Integrating npm imports therefore also requires wiring the live frontend into a module/bundled loading path.

The linked [Mapbox example](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/) uses Mapbox GL JS **3.33.0**. Its standalone HTML example loads Three.js **0.126.0** through CDN scripts, while the page's React example uses ES-module imports for Mapbox GL JS, Three.js, and `GLTFLoader`. The old CDN version should not be copied blindly into this Vite project: choose and validate a compatible package version when implementation is authorized. The repository currently has neither required library installed, so compatibility with particular installed Mapbox/Three versions cannot be verified.

## D. Existing Map Architecture

### Active map and lifecycle

- `frontend\app.js` initializes a global Leaflet `map` in `initMap()`, called from a `DOMContentLoaded` handler.
- The Leaflet map object is held in a module-global variable; there is no React `useRef`, map context, component lifecycle, or unmount cleanup in this live app.
- Leaflet's CSS and JavaScript are loaded from the CDN in the HTML pages. Leaflet is not a package dependency.
- Mapbox is currently a **tile provider**, not the map engine: the app requests raster tiles from the Mapbox `streets-v12` style endpoint. OpenStreetMap is the fallback after repeated tile errors.
- The public Mapbox token is read by the backend from environment configuration and returned to the browser through `/api/config`. It is intentionally client-visible for map requests; the token is not included in this report.

### Existing geographical rendering

The live map uses Leaflet objects and layers:

- Origin/destination: `L.circleMarker`.
- Base route: `L.polyline`.
- Traveled route: Leaflet `L.layerGroup` containing polylines.
- Charging stations and charging stops: Leaflet circle markers, markers, and div icons.
- Animated vehicle: a Leaflet marker with a DOM-based arrow icon, positioned by interpolation along the route.
- Station markers are filtered using the current map bounds, zoom threshold, operational/public status, and selected vehicle connectors.

No `mapboxgl.Map`, Mapbox GL source/layer setup, terrain, Mapbox 3D buildings, Three.js renderer, or custom WebGL layer was found. The Mapbox tiles being used do not provide Mapbox GL JS's `CustomLayerInterface`.

## E. Existing Data Flow

1. **Origin and destination:** Map clicks set JavaScript objects shaped as `{lat, lon}`. The frontend displays Leaflet markers and sends these coordinates in a POST request to `/api/route`.
2. **Vehicle specifications:** The request includes an `ev_profile` with vehicle class, battery capacity, current SOC, SOH, charge rate, reserve SOC, and connector types.
3. **Route response:** The active Express route handler in `server.ts` returns route data including `route.geometry`, distance, energy and time estimates, charging stops, and SOC trace. The geometry is an array of `[longitude, latitude]` coordinates.
4. **Route visualization:** `onRouteResponse()` in `frontend\app.js` passes the geometry to a Leaflet polyline renderer, creates charging-stop cards/markers, and starts the vehicle animation.
5. **Vehicle coordinates:** The animation calculates the vehicle's interpolated latitude and longitude from the route geometry. This is the natural source for a moving 3D model's geographic position.
6. **Charging stations:** The frontend fetches station inventory from `/api/stations/all`. Records are ordinary station objects with `lat` and `lon` fields and station metadata—not rendered GeoJSON features. The nearby-station endpoint also returns station records.
7. **Route alternatives:** The active route API returns a primary route and may include an unmitigated comparison route for diagnostics. It does not expose a general selectable `alternatives` collection.
8. **Elevation:** The separate Python graph code has elevation-related processing, but the live frontend uses the Node Express endpoints. The Node route response inspected here provides 2D route coordinates and no elevation array or altitude per route point. No elevation data currently reaches the map animation.
9. **SOH/SOC:** The frontend sends SOH and SOC in `ev_profile`; the Node backend uses SOH to derive effective battery capacity and returns an SOC trace. SOC is used for UI/animation telemetry, not for geographic positioning.

The Python API's request schema also models lat/lon and EV battery fields, but the frontend flow described above targets the Node Express API.

## F. GLB/GLTF Asset Inventory

No `.glb`, `.gltf`, `.bin`, KTX2, or Basis model/texture assets were found in the application, frontend, public, source, or data directories. There is no existing EV model to load.

The following PNG images were found under public assets; they are not 3D model files:

| File | Size | Assessment |
|---|---:|---|
| `public\assets\aistudio\image_90f61b36.png` | 132,516 bytes | Raster image, not a 3D asset. |
| `public\assets\aistudio\image_eff05ebc.png` | 66,803 bytes | Raster image, not a 3D asset. |
| `public\assets\aistudio\image_fefecde1.png` | 48,494 bytes | Raster image, not a 3D asset. |

The Express server serves `public` as static content, so a future model placed under `public\assets\` could be served by the current server. For browser loading, a self-contained GLB is simplest; a `.gltf` may require its referenced `.bin` and texture files to be present and correctly served. The Mapbox example's remote demonstration model is not a project-specific EV model.

## G. Mapbox + Three.js Compatibility Analysis

### Custom layer and renderer

The example's `type: 'custom'` / `renderingMode: '3d'` layer is a Mapbox GL JS layer. It cannot be passed to the existing Leaflet map. Its `onAdd(map, gl)` receives the WebGL context that Three.js must share with Mapbox; this lifecycle does not exist in Leaflet.

For a future Mapbox implementation:

- Create the Three.js `Scene` and camera in `onAdd`.
- Create the renderer with Mapbox's canvas and shared context; do not create an independent rendering context.
- Set `renderer.autoClear = false` and synchronize/reset renderer state before rendering, as in the example.
- Use `CustomLayerInterface` typing from the selected Mapbox GL JS package.
- Add an `onRemove` cleanup path for renderer and loaded GPU resources. The basic example is illustrative and does not provide complete resource disposal.
- Re-register the custom layer after style reloads, while checking for duplicate layer IDs.
- Handle asynchronous model-load completion if the layer has already been removed or the style has changed.
- `map.painter.context.gl`, used in the example's React snippet, is an internal Mapbox property; prefer the public WebGL context passed to the custom layer's `onAdd`.

### Geographic transform and coordinate conventions

- The app stores point objects as `{lat, lon}`, but route geometry is `[lon, lat]`.
- Leaflet rendering currently converts route coordinates to `[lat, lon]`; Mapbox `MercatorCoordinate.fromLngLat()` expects `[longitude, latitude]`.
- For models located from current animation state, convert the interpolated `{lat, lon}` into `[lon, lat]` before creating/updating the Mercator transform.
- `meterInMercatorCoordinateUnits()` is needed to scale a model authored in meters into Mercator units. Its value depends on latitude.
- Model altitude and rotation need explicit decisions based on the model's origin, axes, and units. A route point has no altitude in the current frontend data.
- Route arrays and station objects will need conversion/adapters for Mapbox sources or model transforms; the existing shapes are not directly Mapbox GeoJSON FeatureCollections.

### React and Vite lifecycle

The linked example includes a React pattern using `useRef` and `useEffect`, but it is not directly applicable to the live app: `src\App.tsx` is an empty scaffold and does not own the active map. Implementing there alone would not display a model in the currently served frontend.

If the live map is later moved into React, the effect must create and remove the Mapbox map, retain a stable map reference, clean up event handlers/layers, and account for React Strict Mode's development lifecycle. If the current vanilla frontend remains, its actual `initMap()` and existing render/update code—not the placeholder React component—are the integration points.

### Performance and lifecycle risks

- A render loop that calls `map.triggerRepaint()` continuously can render needlessly when the vehicle/model is stationary. Repaint should be tied to animation or changed transforms.
- A shared WebGL context makes renderer state management and cleanup important; Three.js must not clear Mapbox's frame.
- Multiple vehicle models should reuse loaded geometry/materials where possible; avoid loading one GLB per animation frame or vehicle.
- Dispose model GPU resources when removing models or replacing styles; avoid disposing Mapbox's shared context.
- GLTF files may have external dependencies; verify all URLs and CORS/static-serving behavior.
- Model heading, scale, vertical placement, and coordinate axis alignment need validation at the target geography.
- The current route has potentially many coordinates. Updating a 3D transform per animation frame is reasonable for one model, but repeated asset loading or rendering multiple full scenes would be costly.

## H. Integration File Mapping

| Existing File | Current Responsibility | Required Change | Reason |
|---|---|---|---|
| `frontend\app.js` | Live Leaflet initialization, routes, markers, station display, and vehicle animation | If Mapbox GL JS is approved, migrate the active map initialization/rendering and pass the animated vehicle coordinates to the model layer; adapt route/station renderers | This is the live map/data integration point. |
| `index.html` | Express-served app page; loads Leaflet and `/static/app.js` | Change map library/style or script loading only as part of an approved renderer migration | This is the active page served at `/`. |
| `frontend\index.css` | Map and Leaflet UI styling | Adapt map container/control styling if switching engines | Existing selectors include Leaflet-specific styles. |
| `server.ts` | Express APIs, route response, station data, static hosting, map token config | No route API change appears necessary for the basic model; it may continue serving a public model asset and existing route response | Existing route geometry and vehicle animation coordinates are already available to the frontend. |
| `package.json` | Runtime/build dependencies and scripts | Add compatible Mapbox GL JS and Three.js dependencies only if implementation is authorized; decide how the live frontend will bundle modules | Neither library is currently installed, and current start script serves a classic frontend. |
| **Proposed new file:** `frontend\ev-model-custom-layer.js` | Does not currently exist | Could encapsulate custom-layer creation, GLTF loading, transforms, and cleanup | Keeps Mapbox/Three rendering logic isolated from route planning and station UI. |
| **Proposed asset directory:** `public\assets\models\` | Does not currently exist | Store the selected EV GLB here | `public` is statically served by Express. |

The proposed custom-layer module would still require Mapbox GL JS; it cannot attach to Leaflet. The user's "do not replace the existing mapping library" constraint therefore conflicts with direct use of the Mapbox example.

## I. Technical Risks

1. **Renderer mismatch:** Leaflet cannot register Mapbox's custom GL layer. This is the primary blocker.
2. **Active frontend ambiguity:** React/Vite files exist, but the empty React app is not the frontend currently served by the Express start path.
3. **Missing dependencies and lockfile:** Mapbox GL JS, Three.js, and `@types/three` are absent; no root lockfile was found to pin a reproducible integration.
4. **Coordinate order:** Existing route geometry is `[lon, lat]`, while point objects use `{lat, lon}`; a mistaken order puts models at incorrect locations.
5. **No elevation:** Current live route geometry has no altitude, so accurate terrain-relative placement cannot be inferred from the route response.
6. **No EV model asset:** A vehicle-specific GLB and its scale/orientation conventions must be supplied or selected.
7. **Shared WebGL state:** Three.js must share Mapbox's WebGL context and avoid clearing or corrupting Mapbox's rendering state.
8. **Style reload and async load:** Re-adding layers, duplicate IDs, and a model finishing loading after map teardown need explicit handling.
9. **Public token exposure:** Browser map tokens are visible to clients by design. Restrict token scopes/URLs in the provider account; do not treat a public token as a server secret.
10. **Existing overlay migration:** Routes, stations, endpoints, charging stops, popups, map bounds, and camera follow currently depend on Leaflet APIs and need equivalents or adapters if the map engine changes.

## J. Minimum Implementation Plan

No changes were made as part of the diagnostic. If the map-engine constraint is lifted, a minimum safe implementation would be:

1. Decide whether the active map is allowed to move from Leaflet to Mapbox GL JS. Without that approval, do not implement the referenced Mapbox custom layer.
2. Select/pin compatible Mapbox GL JS and Three.js versions, add required Three.js type support if using TypeScript, and establish a root lockfile/build path for the live frontend.
3. Obtain a vehicle-specific GLB and confirm its meter scale, forward axis, origin, texture dependencies, and browser-loading requirements. Store it under a public static model directory.
4. Add a dedicated custom-layer module with `onAdd`, `render`, and `onRemove`; use Mapbox's provided WebGL context, `MercatorCoordinate`, and explicit resource cleanup.
5. Wire the module into the **live** map code. Use the existing vehicle-animation state as the model position source, converting `{lat, lon}` to Mapbox longitude/latitude order.
6. Port route polylines, station markers, charging-stop markers, map controls, bounds filtering, and camera follow from Leaflet to the chosen map engine, or provide verified adapters.
7. Validate route/station rendering, model positioning/orientation/scale, style reloads, failed model loads, and sustained animation performance before deployment.

## K. Unresolved Information

- Whether the existing Leaflet map must remain in production. The requested Mapbox custom-layer API requires a Mapbox GL JS map; this report did not replace or migrate it.
- Which EV GLB model should be displayed and its scale, orientation, license, and texture/bin dependencies.
- Whether terrain-relative altitude or elevation-based vehicle placement is required.
- Which exact Mapbox GL JS and Three.js versions should be selected; neither is currently installed, so version-specific package compatibility has not been tested.
- Whether the React/Vite scaffold is intended to become the production frontend. Current package scripts and HTML serving indicate the active application is the vanilla frontend.

## Final Decision: **BLOCKED**

The repository has usable geographic route and station data, and the vehicle animation exposes coordinates suitable for positioning a 3D model. But the current renderer is Leaflet, while the requested integration depends on Mapbox GL JS's custom WebGL layer. Mapbox GL JS and Three.js are also absent, and the repository contains no EV model asset. Direct integration is therefore not supported under the constraint to preserve the existing mapping library.