import * as THREE from 'three';

export const ARCHITECTURAL_MODEL_PARAMETERS = Object.freeze({
  totalHeightMeters: 400,
  podiumHeightMeters: 20,
  mainTowerHeightMeters: 300,
  spireHeightMeters: 80,
  visualFloorBandCount: 120,
  wingCount: 4,
  baysPerWing: 3,
  coreSideCount: 8,
  setbackIntervalFloors: 6,
  visualSetbackDepthMeters: 1.5,
  footprintWidthMeters: 240,
  detailZoom: 17,
});

const { totalHeightMeters, podiumHeightMeters, mainTowerHeightMeters, spireHeightMeters } =
  ARCHITECTURAL_MODEL_PARAMETERS;
const SETBACK_TIER_COUNT = Math.ceil(
  ARCHITECTURAL_MODEL_PARAMETERS.visualFloorBandCount /
  ARCHITECTURAL_MODEL_PARAMETERS.setbackIntervalFloors
);
const INNER_RADIUS_METERS = 9;
const BASE_WING_LENGTH_METERS = 72;
const BASE_WING_HALF_WIDTH_METERS = 16;
const CORE_RADIUS_METERS = 14;

const MATERIALS = {
  tower: new THREE.MeshStandardMaterial({
    color: 0xa6b6bd,
    metalness: 0.46,
    roughness: 0.36,
    side: THREE.DoubleSide,
  }),
  alternateTower: new THREE.MeshStandardMaterial({
    color: 0x8298a2,
    metalness: 0.54,
    roughness: 0.32,
    side: THREE.DoubleSide,
  }),
  core: new THREE.MeshStandardMaterial({
    color: 0x71818a,
    metalness: 0.32,
    roughness: 0.56,
  }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x33596a,
    metalness: 0.6,
    roughness: 0.24,
    side: THREE.DoubleSide,
  }),
  frame: new THREE.MeshStandardMaterial({
    color: 0xd7d3c4,
    metalness: 0.72,
    roughness: 0.29,
    side: THREE.DoubleSide,
  }),
  podium: new THREE.MeshStandardMaterial({
    color: 0x88969a,
    metalness: 0.4,
    roughness: 0.43,
    side: THREE.DoubleSide,
  }),
  ground: new THREE.MeshStandardMaterial({ color: 0x607a62, roughness: 0.94 }),
  road: new THREE.MeshStandardMaterial({ color: 0x353c3d, roughness: 0.97 }),
  path: new THREE.MeshStandardMaterial({ color: 0xc3bba8, roughness: 0.88 }),
  water: new THREE.MeshStandardMaterial({
    color: 0x3e8793,
    metalness: 0.42,
    roughness: 0.2,
  }),
  foliage: new THREE.MeshStandardMaterial({ color: 0x426b4c, roughness: 0.96 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x665342, roughness: 0.96 }),
  light: new THREE.MeshStandardMaterial({
    color: 0xe45b53,
    emissive: 0x9b251e,
    roughness: 0.36,
  }),
};

function createGeometryBuckets() {
  return new Map(Object.values(MATERIALS).map(material => [material, []]));
}

function appendTriangle(bucket, a, b, c) {
  bucket.push(...a, ...b, ...c);
}

function appendQuad(bucket, a, b, c, d) {
  appendTriangle(bucket, a, b, c);
  appendTriangle(bucket, a, c, d);
}

function appendPrimitive(buckets, material, geometry, position, rotation = [0, 0, 0]) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(1, 1, 1)
  );
  geometry.applyMatrix4(matrix);
  const positions = geometry.getAttribute('position');
  const indices = geometry.index?.array;
  const bucket = buckets.get(material);

  if (indices) {
    for (const index of indices) {
      bucket.push(positions.getX(index), positions.getY(index), positions.getZ(index));
    }
  } else {
    bucket.push(...positions.array);
  }
  geometry.dispose();
}

function appendBox(buckets, material, width, height, depth, position) {
  appendPrimitive(buckets, material, new THREE.BoxGeometry(width, height, depth), position);
}

function wingOuterRadius(tier, wing) {
  const tierProgress = tier / SETBACK_TIER_COUNT;
  const staggeredRetractions = Math.max(
    0,
    Math.floor((tier + ARCHITECTURAL_MODEL_PARAMETERS.wingCount - 1 - wing) /
      ARCHITECTURAL_MODEL_PARAMETERS.wingCount)
  );
  return (
    BASE_WING_LENGTH_METERS -
    40 * tierProgress -
    staggeredRetractions * ARCHITECTURAL_MODEL_PARAMETERS.visualSetbackDepthMeters
  );
}

function wingHalfWidth(tier) {
  return BASE_WING_HALF_WIDTH_METERS * (1 - 0.5 * (tier / SETBACK_TIER_COUNT));
}

function wingCorners(wing, y, outerRadius, halfWidth, innerRadius = INNER_RADIUS_METERS) {
  const angle = (wing * Math.PI * 2) / ARCHITECTURAL_MODEL_PARAMETERS.wingCount;
  const radial = [Math.cos(angle), Math.sin(angle)];
  const lateral = [-Math.sin(angle), Math.cos(angle)];
  const point = (radius, offset) => [
    radial[0] * radius + lateral[0] * offset,
    y,
    radial[1] * radius + lateral[1] * offset,
  ];

  return [
    point(innerRadius, -halfWidth),
    point(outerRadius, -halfWidth),
    point(outerRadius, halfWidth),
    point(innerRadius, halfWidth),
  ];
}

function appendWingLoft(buckets, material, wing, bottom, top) {
  const lower = wingCorners(wing, bottom.y, bottom.outerRadius, bottom.halfWidth, bottom.innerRadius);
  const upper = wingCorners(wing, top.y, top.outerRadius, top.halfWidth, top.innerRadius);

  for (let edge = 0; edge < lower.length; edge++) {
    const next = (edge + 1) % lower.length;
    appendQuad(buckets.get(material), lower[edge], lower[next], upper[next], upper[edge]);
  }
  for (let point = 1; point < lower.length - 1; point++) {
    appendTriangle(buckets.get(material), lower[0], lower[point + 1], lower[point]);
    appendTriangle(buckets.get(material), upper[0], upper[point], upper[point + 1]);
  }
}

function appendWingFacade(buckets, wing, floor, floorHeight) {
  const floorTier = Math.floor(floor / ARCHITECTURAL_MODEL_PARAMETERS.setbackIntervalFloors);
  const yBottom = podiumHeightMeters + floor * floorHeight + floorHeight * 0.18;
  const yTop = podiumHeightMeters + (floor + 1) * floorHeight - floorHeight * 0.18;
  const outerRadius = wingOuterRadius(floorTier, wing);
  const halfWidth = wingHalfWidth(floorTier);
  const firstBayRadius = INNER_RADIUS_METERS + 2.8;
  const lastBayRadius = outerRadius - 2.4;
  const bayWidth = (lastBayRadius - firstBayRadius) /
    ARCHITECTURAL_MODEL_PARAMETERS.baysPerWing;
  const angle = (wing * Math.PI * 2) / ARCHITECTURAL_MODEL_PARAMETERS.wingCount;
  const radial = [Math.cos(angle), Math.sin(angle)];
  const lateral = [-Math.sin(angle), Math.cos(angle)];

  for (const side of [-1, 1]) {
    for (let bay = 0; bay < ARCHITECTURAL_MODEL_PARAMETERS.baysPerWing; bay++) {
      const start = firstBayRadius + bay * bayWidth + bayWidth * 0.1;
      const end = firstBayRadius + (bay + 1) * bayWidth - bayWidth * 0.1;
      const offset = side * (halfWidth + 0.45);
      const point = (radius, y) => [
        radial[0] * radius + lateral[0] * offset,
        y,
        radial[1] * radius + lateral[1] * offset,
      ];
      appendQuad(
        buckets.get(MATERIALS.glass),
        point(start, yBottom),
        point(end, yBottom),
        point(end, yTop),
        point(start, yTop)
      );
    }
  }

  const bandY = podiumHeightMeters + floor * floorHeight;
  for (const side of [-1, 1]) {
    const point = (radius, y) => [
      radial[0] * radius + lateral[0] * side * (halfWidth + 0.7),
      y,
      radial[1] * radius + lateral[1] * side * (halfWidth + 0.7),
    ];
    appendQuad(
      buckets.get(MATERIALS.frame),
      point(firstBayRadius, bandY),
      point(lastBayRadius, bandY),
      point(lastBayRadius, bandY + 0.16),
      point(firstBayRadius, bandY + 0.16)
    );
  }
}

function appendPodium(buckets) {
  const podiumTop = podiumHeightMeters;
  const podiumInnerRadius = 0;
  for (let wing = 0; wing < ARCHITECTURAL_MODEL_PARAMETERS.wingCount; wing++) {
    appendWingLoft(
      buckets,
      MATERIALS.podium,
      wing,
      { y: 0, outerRadius: 101, halfWidth: 24, innerRadius: podiumInnerRadius },
      { y: podiumTop, outerRadius: 87, halfWidth: 20, innerRadius: podiumInnerRadius }
    );

    const angle = (wing * Math.PI * 2) / ARCHITECTURAL_MODEL_PARAMETERS.wingCount;
    const entranceRadius = 78;
    const entrancePosition = [
      Math.cos(angle) * entranceRadius,
      podiumTop * 0.42,
      Math.sin(angle) * entranceRadius,
    ];
    appendBox(buckets, MATERIALS.glass, 20, 7, 11, entrancePosition);
  }

  appendPrimitive(
    buckets,
    MATERIALS.podium,
    new THREE.CylinderGeometry(21, 24, podiumTop, 6, 1),
    [0, podiumTop / 2, 0],
    [0, Math.PI / 6, 0]
  );
}

function appendTowerBody(buckets, detail) {
  const tierCount = SETBACK_TIER_COUNT;
  const floors = ARCHITECTURAL_MODEL_PARAMETERS.visualFloorBandCount;
  const floorHeight = mainTowerHeightMeters / floors;
  const tierEvents = [];
  let windowPanelCount = 0;

  for (let tier = 0; tier < tierCount; tier++) {
    const firstFloor = tier * ARCHITECTURAL_MODEL_PARAMETERS.setbackIntervalFloors;
    const lastFloor = Math.min(
      (tier + 1) * ARCHITECTURAL_MODEL_PARAMETERS.setbackIntervalFloors,
      floors
    );
    const yBottom = podiumHeightMeters + firstFloor * floorHeight;
    const yTop = podiumHeightMeters + lastFloor * floorHeight;

    for (let wing = 0; wing < ARCHITECTURAL_MODEL_PARAMETERS.wingCount; wing++) {
      const outerRadius = wingOuterRadius(tier, wing);
      const nextOuterRadius = wingOuterRadius(tier + 1, wing);
      const halfWidth = wingHalfWidth(tier);
      const nextHalfWidth = wingHalfWidth(tier + 1);
      appendWingLoft(
        buckets,
        tier % 2 === 0 ? MATERIALS.tower : MATERIALS.alternateTower,
        wing,
        { y: yBottom, outerRadius, halfWidth },
        { y: yTop, outerRadius: nextOuterRadius, halfWidth: nextHalfWidth }
      );
      if (tier > 0 && nextOuterRadius < outerRadius) {
        tierEvents.push({ tier, wing, setbackMeters: outerRadius - nextOuterRadius });
      }
    }
  }

  appendPrimitive(
    buckets,
    MATERIALS.core,
    new THREE.CylinderGeometry(
      CORE_RADIUS_METERS,
      CORE_RADIUS_METERS,
      mainTowerHeightMeters,
      ARCHITECTURAL_MODEL_PARAMETERS.coreSideCount,
      1
    ),
    [0, podiumHeightMeters + mainTowerHeightMeters / 2, 0],
    [0, Math.PI / 6, 0]
  );

  if (detail === 'full') {
    for (let floor = 0; floor < floors; floor++) {
      for (let wing = 0; wing < ARCHITECTURAL_MODEL_PARAMETERS.wingCount; wing++) {
        appendWingFacade(buckets, wing, floor, floorHeight);
        windowPanelCount += ARCHITECTURAL_MODEL_PARAMETERS.baysPerWing * 2;
      }
    }
  }

  return { floorHeight, tierEvents, windowPanelCount };
}

function appendSpire(buckets) {
  const spireBaseY = podiumHeightMeters + mainTowerHeightMeters;
  const segments = [
    { height: 32, bottomRadius: 2.7, topRadius: 1.7 },
    { height: 26, bottomRadius: 1.7, topRadius: 0.9 },
    { height: 22, bottomRadius: 0.9, topRadius: 0.12 },
  ];
  let baseY = spireBaseY;

  for (const segment of segments) {
    appendPrimitive(
      buckets,
      MATERIALS.frame,
      new THREE.CylinderGeometry(
        segment.topRadius,
        segment.bottomRadius,
        segment.height,
        8,
        3
      ),
      [0, baseY + segment.height / 2, 0]
    );
    baseY += segment.height;
  }

  for (const y of [spireBaseY + 31, spireBaseY + 57, spireBaseY + 74]) {
    appendPrimitive(
      buckets,
      MATERIALS.light,
      new THREE.SphereGeometry(0.65, 6, 4),
      [0, y, 0]
    );
  }
}

function appendLandscape(buckets, detail) {
  const siteSize = ARCHITECTURAL_MODEL_PARAMETERS.footprintWidthMeters;
  const roadWidth = 12;
  const roadOffset = siteSize / 2 - roadWidth / 2;
  appendBox(buckets, MATERIALS.ground, siteSize, 0.8, siteSize, [0, 0.4, 0]);

  for (const offset of [-roadOffset, roadOffset]) {
    appendBox(buckets, MATERIALS.road, siteSize, 0.12, roadWidth, [0, 0.46, offset]);
    appendBox(buckets, MATERIALS.road, roadWidth, 0.12, siteSize, [offset, 0.46, 0]);
  }

  for (const offset of [-72, 72]) {
    appendBox(buckets, MATERIALS.path, 7, 0.16, 48, [0, 0.53, offset]);
    appendBox(buckets, MATERIALS.path, 48, 0.16, 7, [offset, 0.53, 0]);
  }

  appendBox(buckets, MATERIALS.path, 42, 0.18, 18, [0, 0.55, -78]);
  appendBox(buckets, MATERIALS.water, 38, 0.2, 14, [0, 0.68, -78]);

  if (detail !== 'full') return;

  const treeLocations = [
    [-105, -99], [-72, -102], [-38, -105], [38, -105], [72, -102], [105, -99],
    [-105, 99], [-72, 102], [-38, 105], [38, 105], [72, 102], [105, 99],
    [-104, -40], [-104, 0], [-104, 40], [104, -40], [104, 0], [104, 40],
  ];

  for (const [x, z] of treeLocations) {
    appendPrimitive(
      buckets,
      MATERIALS.trunk,
      new THREE.CylinderGeometry(0.8, 1.2, 7, 5),
      [x, 4.3, z]
    );
    appendPrimitive(
      buckets,
      MATERIALS.foliage,
      new THREE.ConeGeometry(4.5, 12, 6),
      [x, 12, z]
    );
    appendPrimitive(
      buckets,
      MATERIALS.foliage,
      new THREE.ConeGeometry(3.2, 9, 6),
      [x, 18, z]
    );
  }
}

export function createArchitecturalTower({ detail = 'full' } = {}) {
  if (detail !== 'full' && detail !== 'simplified') {
    throw new Error(`Unknown architectural tower detail level: ${detail}`);
  }

  const buckets = createGeometryBuckets();
  appendLandscape(buckets, detail);
  appendPodium(buckets);
  const { floorHeight, tierEvents, windowPanelCount } = appendTowerBody(buckets, detail);
  appendSpire(buckets);

  const model = new THREE.Group();
  for (const [material, positions] of buckets) {
    if (positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    model.add(new THREE.Mesh(geometry, material));
  }

  model.userData.architecture = {
    totalHeightMeters,
    podiumHeightMeters,
    mainTowerHeightMeters,
    spireHeightMeters,
    floorBandCount: ARCHITECTURAL_MODEL_PARAMETERS.visualFloorBandCount,
    floorHeightMeters: floorHeight,
    wingCount: ARCHITECTURAL_MODEL_PARAMETERS.wingCount,
    baysPerWing: ARCHITECTURAL_MODEL_PARAMETERS.baysPerWing,
    coreSideCount: ARCHITECTURAL_MODEL_PARAMETERS.coreSideCount,
    setbackIntervalFloors: ARCHITECTURAL_MODEL_PARAMETERS.setbackIntervalFloors,
    setbackEvents: tierEvents,
    windowPanelCount,
    podiumArmCount: ARCHITECTURAL_MODEL_PARAMETERS.wingCount,
    facadeDetail: detail,
    structuralApproval: false,
  };

  return model;
}

export function measureArchitecturalTower(model) {
  const bounds = new THREE.Box3().setFromObject(model);
  return {
    width: bounds.max.x - bounds.min.x,
    depth: bounds.max.z - bounds.min.z,
    height: bounds.max.y - bounds.min.y,
    minY: bounds.min.y,
    maxY: bounds.max.y,
  };
}
