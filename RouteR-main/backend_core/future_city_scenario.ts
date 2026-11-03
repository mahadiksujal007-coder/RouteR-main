type PointGeometry = {
  type: "Point";
  coordinates: [number, number];
};

type PolygonGeometry = {
  type: "Polygon";
  coordinates: number[][][];
};

type FutureCityFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
};

export type FutureCityCollection = {
  type: "FeatureCollection";
  name?: string;
  features: FutureCityFeature[];
  metadata: Record<string, unknown>;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function createBuildingGeometry(
  longitude: number,
  latitude: number,
  cityLatitude: number,
  bearingDegrees: number,
  widthMeters: number,
  depthMeters: number,
): PolygonGeometry {
  const cosineLatitude = Math.cos(cityLatitude * Math.PI / 180);
  const angle = bearingDegrees * Math.PI / 180;
  const corners: Array<[number, number]> = [
    [-widthMeters / 2, -depthMeters / 2],
    [widthMeters / 2, -depthMeters / 2],
    [widthMeters / 2, depthMeters / 2],
    [-widthMeters / 2, depthMeters / 2],
    [-widthMeters / 2, -depthMeters / 2],
  ];
  return {
    type: "Polygon",
    coordinates: [
      corners.map(([x, y]) => {
        const east = x * Math.cos(angle) - y * Math.sin(angle);
        const north = x * Math.sin(angle) + y * Math.cos(angle);
        return [
          longitude + east / (111320 * cosineLatitude),
          latitude + north / 111320,
        ];
      }),
    ],
  };
}

export function createFutureCityScenario(
  source: FutureCityCollection,
  seed: number,
): FutureCityCollection {
  const city = source.metadata.city as
    | { id?: unknown; center?: { lat?: unknown; lon?: unknown } }
    | undefined;
  if (
    !city ||
    typeof city.id !== "string" ||
    !isFiniteNumber(city.center?.lat) ||
    !isFiniteNumber(city.center?.lon) ||
    !Array.isArray(source.features)
  ) {
    throw new Error("Future-city data is missing valid city center metadata.");
  }

  const candidates = source.features.filter((feature) => {
    const coordinates = feature.geometry.coordinates;
    return feature.properties.feature_type === "candidate-site" &&
      feature.geometry.type === "Point" &&
      Array.isArray(coordinates) &&
      coordinates.length >= 2 &&
      isFiniteNumber(coordinates[0]) &&
      isFiniteNumber(coordinates[1]) &&
      isFiniteNumber(feature.properties.bearing_deg);
  });
  if (candidates.length === 0) {
    throw new Error(`Future-city data for ${city.id} contains no buildable candidate sites.`);
  }

  const buildingLimit = source.metadata.max_generated_buildings;
  const towerLimit = source.metadata.signature_tower_target;
  if (
    !isFiniteNumber(buildingLimit) ||
    !isFiniteNumber(towerLimit) ||
    buildingLimit < 1 ||
    towerLimit < 1
  ) {
    throw new Error(`Future-city data for ${city.id} has invalid scenario limits.`);
  }

  const [cityLongitude, cityLatitude] = [city.center.lon, city.center.lat];
  const random = makeRandom((seed ^ [...city.id].reduce((hash, char) => (
    Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  ), 2166136261)) >>> 0);
  const orderedCandidates = candidates.slice().sort((left, right) => {
    const [leftLon, leftLat] = left.geometry.coordinates as [number, number];
    const [rightLon, rightLat] = right.geometry.coordinates as [number, number];
    const leftDistance = (leftLon - cityLongitude) ** 2 + (leftLat - cityLatitude) ** 2;
    const rightDistance = (rightLon - cityLongitude) ** 2 + (rightLat - cityLatitude) ** 2;
    return leftDistance - rightDistance;
  });
  const signatureTowers = Math.min(towerLimit, orderedCandidates.length);
  const signatureSites = orderedCandidates.slice(0, signatureTowers);
  const otherSites = shuffle(orderedCandidates.slice(signatureTowers), random);
  const selectedSites = [...signatureSites, ...otherSites].slice(
    0,
    Math.min(buildingLimit, candidates.length),
  );
  const buildingClasses = [
    { type: "signature", count: signatureSites.length, height: 100, width: 46, depth: 42 },
    { type: "secondary_skyscraper", count: Math.round(buildingLimit * 0.1), height: 75, width: 50, depth: 42 },
    { type: "high_rise", count: Math.round(buildingLimit * 0.18), height: 55, width: 46, depth: 38 },
    { type: "mid_rise", count: Math.round(buildingLimit * 0.38), height: 32, width: 38, depth: 32 },
  ];
  const allocations: Array<{
    type: string;
    height: number;
    width: number;
    depth: number;
  }> = [];
  let remaining = selectedSites.length;
  for (const buildingClass of buildingClasses) {
    const count = Math.min(buildingClass.count, remaining);
    allocations.push(...Array.from({ length: count }, () => buildingClass));
    remaining -= count;
  }
  allocations.push(...Array.from({ length: remaining }, () => ({
    type: "low_rise",
    height: 14,
    width: 30,
    depth: 26,
  })));

  const syntheticTowers: FutureCityFeature[] = [];
  const syntheticBuildings: FutureCityFeature[] = selectedSites.map((site, index) => {
    const [longitude, latitude] = site.geometry.coordinates as [number, number];
    const building = allocations[index];
    const districtColor = typeof site.properties.district_color === "string"
      ? site.properties.district_color
      : "#78909c";
    const feature: FutureCityFeature = {
      type: "Feature",
      geometry: createBuildingGeometry(
        longitude,
        latitude,
        cityLatitude,
        Number(site.properties.bearing_deg),
        building.width,
        building.depth,
      ),
      properties: {
        feature_type: "future-building",
        city_id: city.id,
        building_id: `${city.id}-seed-${seed}-${index + 1}`,
        district_id: site.properties.district_id,
        district_name: site.properties.district_name,
        district_color: districtColor,
        building_type: building.type,
        height_m: building.height,
        base_height_m: 0,
        footprint_width_m: building.width,
        footprint_depth_m: building.depth,
        bearing_deg: Number(site.properties.bearing_deg),
        slope_percent: site.properties.slope_percent,
        is_synthetic: true,
        scenario_year: 2050,
        generation_seed: seed,
        architecture_style: building.type === "signature"
          ? "three-wing-radial-setback"
          : "contemporary-sustainable",
        tower_instance: building.type === "signature",
        popupHtml: `<strong>Proposed synthetic building</strong><br>${building.type.replaceAll("_", " ")} · ${building.height} m<br>${String(site.properties.district_name)}<br>2050 scenario · Seed ${seed}`,
      },
    };
    if (building.type === "signature") {
      syntheticTowers.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        properties: {
          feature_type: "future-tower",
          city_id: city.id,
          building_id: feature.properties.building_id,
          building_type: "signature",
          height_m: 100,
          bearing_deg: Number(site.properties.bearing_deg),
          is_synthetic: true,
          scenario_year: 2050,
          generation_seed: seed,
        },
      });
    }
    return feature;
  });

  const staticFeatures = source.features.filter(
    (feature) => (
      feature.properties.feature_type !== "future-building" &&
      feature.properties.feature_type !== "future-tower"
    ),
  );
  return {
    ...source,
    features: [...staticFeatures, ...syntheticBuildings, ...syntheticTowers],
    metadata: {
      ...source.metadata,
      active_generation_seed: seed,
      active_synthetic_buildings: syntheticBuildings.length,
      active_signature_towers: syntheticBuildings.filter(
        (feature) => feature.properties.building_type === "signature",
      ).length,
    },
  };
}
