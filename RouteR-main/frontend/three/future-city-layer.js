import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';

const LAYER_ID = 'future-city-signature-towers';
const TOWER_HEIGHT_METERS = 100;
const MAX_TOWERS = 16;
const TIER_COUNT = 6;

const towerMaterial = new THREE.MeshStandardMaterial({
  color: 0xc6d8df,
  metalness: 0.62,
  roughness: 0.28,
});

function createTowerGeometry() {
  const positions = [];
  const core = new THREE.CylinderGeometry(8, 12, 92, 8, 6);
  core.translate(0, 46, 0);
  const geometries = [core];

  for (let tier = 0; tier < TIER_COUNT; tier += 1) {
    const height = 88 / TIER_COUNT;
    const scale = 1 - tier * 0.12;
    const wingLength = 36 * scale;
    const wingWidth = 12 * scale;
    const wingGeometry = new THREE.BoxGeometry(wingLength, height, wingWidth);
    for (let wing = 0; wing < 3; wing += 1) {
      const angle = wing * Math.PI * 2 / 3;
      const centerRadius = wingLength / 2 - 5;
      const transform = new THREE.Matrix4().compose(
        new THREE.Vector3(
          Math.cos(angle) * centerRadius,
          tier * height + height / 2,
          Math.sin(angle) * centerRadius,
        ),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle),
        new THREE.Vector3(1, 1, 1),
      );
      geometries.push(wingGeometry.clone().applyMatrix4(transform));
    }
    wingGeometry.dispose();
  }

  const spire = new THREE.ConeGeometry(2.4, 12, 6);
  spire.translate(0, 94, 0);
  geometries.push(spire);

  geometries.forEach((geometry) => {
    const position = geometry.getAttribute('position');
    const indices = geometry.index?.array;
    if (indices) {
      for (const index of indices) {
        positions.push(position.getX(index), position.getY(index), position.getZ(index));
      }
    } else {
      positions.push(...position.array);
    }
    geometry.dispose();
  });

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}

function isValidTower(feature) {
  if (feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) {
    return false;
  }
  const [longitude, latitude] = feature.geometry.coordinates.map(Number);
  return Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90;
}

export function createFutureCityLayer({ minimumZoom = 12.5 } = {}) {
  let map;
  let renderer;
  let camera;
  let scene;
  let towersMesh;
  let towers = [];
  let visible = true;
  let contextCanvas;
  let rendererLost = false;

  function updateInstances() {
    if (!map || !towersMesh) return;
    const center = map.getCenter();
    const anchor = mapboxgl.MercatorCoordinate.fromLngLat([center.lng, center.lat], 0);
    const meterScale = anchor.meterInMercatorCoordinateUnits();
    const object = new THREE.Object3D();
    const candidates = towers.filter(isValidTower).slice(0, MAX_TOWERS);
    towersMesh.count = candidates.length;
    candidates.forEach((feature, index) => {
      const [longitude, latitude] = feature.geometry.coordinates.map(Number);
      const point = mapboxgl.MercatorCoordinate.fromLngLat([longitude, latitude], 0);
      const bearing = Number(feature.properties?.bearing_deg) || 0;
      object.position.set(
        (point.x - anchor.x) / meterScale,
        0,
        -(point.y - anchor.y) / meterScale,
      );
      object.rotation.set(0, -bearing * Math.PI / 180, 0);
      object.scale.setScalar(1);
      object.updateMatrix();
      towersMesh.setMatrixAt(index, object.matrix);
    });
    towersMesh.instanceMatrix.needsUpdate = true;
    towersMesh.computeBoundingSphere();
  }

  function handleContextLost(event) {
    event.preventDefault();
    rendererLost = true;
  }

  function handleContextRestored() {
    rendererLost = false;
    renderer?.resetState();
    map?.triggerRepaint();
  }

  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(currentMap, gl) {
      map = currentMap;
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      const geometry = createTowerGeometry();
      towersMesh = new THREE.InstancedMesh(geometry, towerMaterial, MAX_TOWERS);
      towersMesh.count = 0;
      towersMesh.frustumCulled = false;
      scene.add(towersMesh);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x57616a, 2.2));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2);
      keyLight.position.set(-20, 50, 30);
      scene.add(keyLight);

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
        alpha: true,
      });
      renderer.autoClear = false;
      renderer.setPixelRatio(1);
      contextCanvas = map.getCanvas();
      contextCanvas.addEventListener('webglcontextlost', handleContextLost);
      contextCanvas.addEventListener('webglcontextrestored', handleContextRestored);
      updateInstances();
    },
    render(_gl, matrix) {
      if (!renderer || !camera || !map || rendererLost || !visible || map.getZoom() < minimumZoom) {
        return;
      }
      const center = map.getCenter();
      const anchor = mapboxgl.MercatorCoordinate.fromLngLat([center.lng, center.lat], 0);
      const meterScale = anchor.meterInMercatorCoordinateUnits();
      const modelMatrix = new THREE.Matrix4()
        .makeTranslation(anchor.x, anchor.y, anchor.z)
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeScale(meterScale, meterScale, meterScale));
      camera.projectionMatrix.fromArray(matrix).multiply(modelMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      contextCanvas?.removeEventListener('webglcontextlost', handleContextLost);
      contextCanvas?.removeEventListener('webglcontextrestored', handleContextRestored);
      towersMesh?.geometry.dispose();
      renderer?.dispose();
      renderer = undefined;
      camera = undefined;
      scene = undefined;
      towersMesh = undefined;
      contextCanvas = undefined;
      map = undefined;
    },
    setTowers(features) {
      towers = Array.isArray(features) ? features : [];
      updateInstances();
      map?.triggerRepaint();
    },
    setVisible(value) {
      visible = Boolean(value);
      map?.triggerRepaint();
    },
  };
}
