// Runtime validation coverage for the active Mapbox frontend and server endpoints.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mapboxgl from 'mapbox-gl';
import { calculateStationLocalOffset } from '../frontend/three/charging-station-layer.js';
import {
  ARCHITECTURAL_MODEL_PARAMETERS,
  createArchitecturalTower,
  measureArchitecturalTower,
} from '../frontend/three/architectural-tower-model.js';
import {
  createFutureCityScenario,
  type FutureCityCollection,
} from '../backend_core/future_city_scenario.ts';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(projectDirectory, 'server.ts');
const tsxCli = path.join(projectDirectory, 'node_modules', 'tsx', 'dist', 'cli.mjs');
let serverProcess: ChildProcess;
let baseUrl: string;

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not determine an available test port.');
  }
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Test server exited with code ${serverProcess.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error('Test server did not become ready within 20 seconds.');
}

beforeAll(async () => {
  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: projectDirectory,
    env: { ...process.env, PORT: String(port), MAPBOX_PUBLIC_TOKEN: '' },
    stdio: 'ignore'
  });
  await waitForHealth();
}, 30_000);

afterAll(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill();
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 5_000);
    serverProcess.once('exit', () => resolve());
    serverProcess.once('exit', () => clearTimeout(timeout));
  });
});

describe('active Mapbox frontend and API', () => {
  it('creates deterministic 100 m synthetic towers from buildable city sites', () => {
    const source: FutureCityCollection = {
      type: 'FeatureCollection',
      features: Array.from({ length: 10 }, (_, index) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [74.5 + index * 0.001, 17.3 + index * 0.001],
        },
        properties: {
          feature_type: 'candidate-site',
          bearing_deg: index * 10,
          slope_percent: 5,
          district_id: 'vita-district-1',
          district_name: 'Central Business District',
          district_color: '#D9A441',
        },
      })),
      metadata: {
        city: { id: 'vita', center: { lat: 17.3, lon: 74.5 } },
        max_generated_buildings: 6,
        signature_tower_target: 2,
      },
    };

    const first = createFutureCityScenario(source, 2050);
    const replay = createFutureCityScenario(source, 2050);
    const alternate = createFutureCityScenario(source, 2051);
    const buildings = first.features.filter(
      feature => feature.properties.feature_type === 'future-building'
    );
    const towers = first.features.filter(
      feature => feature.properties.feature_type === 'future-tower'
    );

    expect(first).toEqual(replay);
    expect(first.features).not.toEqual(alternate.features);
    expect(buildings).toHaveLength(6);
    expect(towers).toHaveLength(2);
    expect(towers.every(tower => (
      tower.properties.height_m === 100 &&
      tower.properties.is_synthetic === true &&
      tower.geometry.type === 'Point'
    ))).toBe(true);
    expect(buildings.every(building => (
      building.properties.is_synthetic === true &&
      building.properties.scenario_year === 2050 &&
      building.properties.generation_seed === 2050
    ))).toBe(true);
  });

  it('builds an original, detailed 400 m radial tower with a landscaped site', () => {
    const fullDetail = createArchitecturalTower({ detail: 'full' });
    const simplified = createArchitecturalTower({ detail: 'simplified' });
    const fullBounds = measureArchitecturalTower(fullDetail);
    const simplifiedBounds = measureArchitecturalTower(simplified);
    const architecture = fullDetail.userData.architecture;

    expect(ARCHITECTURAL_MODEL_PARAMETERS.podiumHeightMeters +
      ARCHITECTURAL_MODEL_PARAMETERS.mainTowerHeightMeters +
      ARCHITECTURAL_MODEL_PARAMETERS.spireHeightMeters).toBe(400);
    expect(fullBounds.minY).toBeCloseTo(0, 5);
    expect(fullBounds.height).toBeCloseTo(400, 5);
    expect(fullBounds.width).toBeGreaterThanOrEqual(240);
    expect(fullBounds.depth).toBeGreaterThanOrEqual(240);
    expect(simplifiedBounds).toEqual(fullBounds);
    expect(architecture.wingCount).toBe(4);
    expect(architecture.baysPerWing).toBe(3);
    expect(architecture.coreSideCount).toBe(8);
    expect(architecture.setbackIntervalFloors).toBe(6);
    expect(architecture.setbackEvents.length).toBeGreaterThan(15);
    expect(new Set(
      architecture.setbackEvents.map((event: { wing: number }) => event.wing)
    )).toEqual(new Set([0, 1, 2, 3]));
    expect(architecture.windowPanelCount).toBe(120 * 4 * 3 * 2);
    expect(fullDetail.children.length).toBeLessThanOrEqual(16);
    expect(simplified.userData.architecture.windowPanelCount).toBe(0);
    expect(architecture.facadeDetail).toBe('full');
    expect(simplified.userData.architecture.facadeDetail).toBe('simplified');
  });

  it('projects station coordinates as longitude/latitude at multiple Indian latitudes', () => {
    for (const latitude of [6, 22, 38]) {
      const longitude = 74;
      const anchor = mapboxgl.MercatorCoordinate.fromLngLat([longitude, latitude], 0);
      const eastward = calculateStationLocalOffset(longitude + 0.01, latitude, anchor);
      const northward = calculateStationLocalOffset(longitude, latitude + 0.01, anchor);

      expect(eastward.x).toBeGreaterThan(0);
      expect(eastward.z).toBeCloseTo(0, 3);
      expect(northward.z).toBeGreaterThan(0);
      expect(eastward.y).toBe(0);
      expect(northward.y).toBe(0);
    }
  });

  it('serves the Mapbox page and frontend script', async () => {
    const pageResponse = await fetch(baseUrl);
    expect(pageResponse.status).toBe(200);
    const page = await pageResponse.text();
    expect(page).toContain('/static/charging-station-runtime.js');
    expect(page).toContain('btn-toggle-architectural-layer');
    expect(page).toContain('btn-toggle-terrain');
    expect(page).toContain('future-city-select');
    expect(page).toContain('future-city-regenerate');

    const scriptResponse = await fetch(`${baseUrl}/static/app.js`);
    expect(scriptResponse.status).toBe(200);
    const script = await scriptResponse.text();
    expect(script).toContain('new mapboxgl.Map');
    expect(script).toContain('route-source');
    expect(script).toContain('charging-stations-clusters');
    expect(script).toContain('cluster: true');
    expect(script).toContain('charging-stations-cluster-count');
    expect(script).toContain('setVisible(isArchitecturalLayerVisible)');
    expect(script).toContain('mapbox.mapbox-terrain-dem-v1');
    expect(script).toContain('map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.15 })');
    expect(script).toContain('route-terrain-hillshade');
    expect(script).toContain('future-city-signature-towers');
    expect(script).toContain('future-city-proposed-buildings');

    const runtimeResponse = await fetch(`${baseUrl}/static/charging-station-runtime.js`);
    expect(runtimeResponse.status).toBe(200);
    const runtime = await runtimeResponse.text();
    expect(runtime).toContain('ev-charging-station-3d-layer');
    expect(runtime).toContain('future-city-signature-towers');
    expect(runtime).toContain('400');
    expect(runtime).toContain('100');

    const styleResponse = await fetch(`${baseUrl}/static/charging-station-runtime.css`);
    expect(styleResponse.status).toBe(200);
  });

  it('reports the server as ready', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const health = await response.json() as { status: string };
    expect(health.status).toBe('ready');
  });

  it('returns Mapbox configuration without disclosing its token in test output', async () => {
    const response = await fetch(`${baseUrl}/api/config`);
    expect(response.status).toBe(200);
    const config = await response.json() as { mapboxPublicToken: string };
    expect(typeof config.mapboxPublicToken).toBe('string');
  });

  it('serves OSM-attributed future-city catalog and provisional boundaries', async () => {
    const catalogResponse = await fetch(`${baseUrl}/data/future-cities/catalog.json`);
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json() as {
      osm_attribution: string;
      official_boundaries: boolean;
      cities: Array<{ id: string; center: { lat: number; lon: number } }>;
    };
    expect(catalog.osm_attribution).toContain('OpenStreetMap contributors');
    expect(catalog.official_boundaries).toBe(false);
    expect(catalog.cities.map(city => city.id)).toEqual([
      'vita',
      'nevari',
      'tasgaon',
      'chinchani-ambak',
    ]);

    for (const city of catalog.cities) {
      const response = await fetch(
        `${baseUrl}/data/future-cities/boundaries/${city.id}.geojson`
      );
      expect(response.status).toBe(200);
      const boundary = await response.json() as {
        metadata: { official_boundary: boolean; osm_license: string };
        features: Array<{
          geometry: { type: string; coordinates: unknown };
          properties: { feature_type?: string; official_boundary?: boolean };
        }>;
      };
      expect(boundary.metadata.official_boundary).toBe(false);
      expect(boundary.metadata.osm_license).toContain('ODbL');
      const anchor = boundary.features.find(
        feature => feature.properties.feature_type === 'city-anchor'
      );
      expect(anchor?.geometry.type).toBe('Point');
      expect(anchor?.geometry.coordinates).toEqual([city.center.lon, city.center.lat]);
    }
  });

  it('serves seeded city scenarios without altering the EV charger inventory', async () => {
    const initialInventoryResponse = await fetch(`${baseUrl}/api/stations/status`);
    const initialInventory = await initialInventoryResponse.json() as {
      total_stations: number;
    };
    const response = await fetch(`${baseUrl}/api/future-cities/vita/scenario?seed=2050`);
    expect(response.status).toBe(200);
    const scenario = await response.json() as {
      metadata: {
        active_generation_seed: number;
        active_signature_towers: number;
        city: { featureCounts: { candidateSites: number; observedBuildingsWithin1Km: number } };
      };
      features: Array<{
        geometry: { type: string; coordinates: unknown };
        properties: Record<string, unknown>;
      }>;
    };
    expect(scenario.metadata.active_generation_seed).toBe(2050);
    expect(scenario.metadata.city.featureCounts.candidateSites).toBeGreaterThan(0);
    expect(scenario.metadata.city.featureCounts.observedBuildingsWithin1Km).toBeGreaterThan(0);
    expect(scenario.metadata.active_signature_towers).toBeGreaterThan(0);
    expect(scenario.features.filter(
      feature => feature.properties.feature_type === 'future-building'
    ).every(feature => feature.properties.is_synthetic === true)).toBe(true);
    expect(scenario.features.filter(
      feature => feature.properties.feature_type === 'future-tower'
    ).every(feature => (
      feature.properties.height_m === 100 &&
      feature.geometry.type === 'Point'
    ))).toBe(true);

    const replayResponse = await fetch(`${baseUrl}/api/future-cities/vita/scenario?seed=2050`);
    const replay = await replayResponse.json() as typeof scenario;
    expect(replay.features).toEqual(scenario.features);

    const alternateResponse = await fetch(`${baseUrl}/api/future-cities/vita/scenario?seed=2051`);
    const alternate = await alternateResponse.json() as typeof scenario;
    expect(alternate.features).not.toEqual(scenario.features);

    const invalidSeedResponse = await fetch(`${baseUrl}/api/future-cities/vita/scenario?seed=-1`);
    expect(invalidSeedResponse.status).toBe(400);
    const missingCityResponse = await fetch(`${baseUrl}/api/future-cities/unknown/scenario`);
    expect(missingCityResponse.status).toBe(404);

    const finalInventoryResponse = await fetch(`${baseUrl}/api/stations/status`);
    const finalInventory = await finalInventoryResponse.json() as typeof initialInventory;
    expect(finalInventory.total_stations).toBe(initialInventory.total_stations);
  });

  it('returns the station inventory consumed by the map', async () => {
    const response = await fetch(`${baseUrl}/api/stations/all`);
    expect(response.status).toBe(200);
      const inventory = await response.json() as {
        total: number;
        stations: Array<{
          lat: number;
          lon: number;
          state?: string;
          data_source?: string;
          power_kw?: number;
          connector_types?: string[];
          is_public?: boolean;
        }>;
      };
      expect(inventory.total).toBeGreaterThan(0);
      expect(inventory.stations).toHaveLength(inventory.total);

      const geographicallyValidStations = inventory.stations.filter(station =>
        Number.isFinite(station.lat) &&
        station.lat >= -90 &&
        station.lat <= 90 &&
        Number.isFinite(station.lon) &&
        station.lon >= -180 &&
        station.lon <= 180
      );
      const coveredStates = new Set(
        geographicallyValidStations
          .map(station => station.state?.trim())
          .filter((state): state is string => Boolean(state))
      );
      expect(geographicallyValidStations.length).toBeGreaterThan(25_000);
      expect(coveredStates.size).toBeGreaterThanOrEqual(20);

      const mergedCsvStations = inventory.stations.filter(
        station => station.data_source === 'EV_Charging_Stations_India_unique.csv'
      );
      expect(mergedCsvStations.length).toBeGreaterThan(8);
      expect(mergedCsvStations.every(station =>
        station.lat >= 6 &&
        station.lat <= 38 &&
        station.lon >= 68 &&
        station.lon <= 98 &&
        Number(station.power_kw) > 0 &&
        station.is_public === true &&
        Array.isArray(station.connector_types) &&
        station.connector_types.length > 0 &&
        [40, 80, 160].includes(Number(station.power_kw))
      )).toBe(true);

      const capacityBuckets = inventory.stations.reduce(
        (acc, station) => {
          const power = Number(station.power_kw);
          if (power === 40 || power === 80 || power === 160) acc[power] += 1;
          return acc;
        },
        { 40: 0, 80: 0, 160: 0 } as Record<40 | 80 | 160, number>
      );
      expect(capacityBuckets[40]).toBeGreaterThan(5_000);
      expect(capacityBuckets[80]).toBeGreaterThan(5_000);
      expect(capacityBuckets[160]).toBeGreaterThan(2_000);
    });

    it('uses the maximum five distinct, geographically progressive stops on the longest benchmark route', async () => {
      const origin = { lat: 19.076, lon: 72.8777 };
      const destination = { lat: 28.6139, lon: 77.209 };
      const response = await fetch(`${baseUrl}/api/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          destination,
          ev_profile: {
            vehicle_class: 'medium-duty',
            battery_capacity_kwh: 80,
            soc_current: 0.95,
            soh: 1,
            soc_min_reserve: 0.1,
            max_charge_rate_kw: 120,
            connector_types: ['CCS2', 'Type2'],
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      expect(response.status).toBe(200);

      const route = await response.json() as {
        feasible: boolean;
        route: { total_distance_km: number };
        charging_stops: Array<{
          ocm_id: number;
          lat: number;
          lon: number;
          arrival_soc: number;
          departure_soc: number;
        }>;
      };
      expect(route.feasible).toBe(true);
      expect(route.route.total_distance_km).toBeGreaterThan(1_000);
      expect(route.charging_stops).toHaveLength(5);
      expect(new Set(route.charging_stops.map(stop => stop.ocm_id)).size)
        .toBe(route.charging_stops.length);

      const routeLongitude = destination.lon - origin.lon;
      const routeLatitude = destination.lat - origin.lat;
      const routeLengthSquared = routeLongitude ** 2 + routeLatitude ** 2;
      const progress = route.charging_stops.map(stop =>
        ((stop.lon - origin.lon) * routeLongitude +
          (stop.lat - origin.lat) * routeLatitude) / routeLengthSquared
      );
      expect(progress.every((value, index) =>
        value > 0 && value < 1 && (index === 0 || value > progress[index - 1])
      )).toBe(true);
      expect(progress[progress.length - 1] - progress[0]).toBeGreaterThan(0.3);
      expect(route.charging_stops.every(stop =>
        stop.arrival_soc >= 0 &&
        stop.arrival_soc <= 1 &&
        stop.departure_soc >= stop.arrival_soc &&
        stop.departure_soc <= 1
      )).toBe(true);
    }, 120_000);
});
