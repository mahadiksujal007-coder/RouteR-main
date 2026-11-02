import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';
import {
  ARCHITECTURAL_MODEL_PARAMETERS,
  createArchitecturalTower,
} from './architectural-tower-model.js';

const LAYER_ID = 'ev-charging-station-3d-layer';
const MAX_INSTANCES = 1200;

function stationId(feature, fallbackIndex) {
  return String(feature.id ?? feature.properties?.stationId ?? feature.properties?.id ?? fallbackIndex);
}

function isValidStationPoint(feature) {
  if (feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return false;
  const [longitude, latitude] = feature.geometry.coordinates.map(Number);
  return Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90;
}

export function calculateStationLocalOffset(longitude, latitude, anchorCoordinate) {
  const point = mapboxgl.MercatorCoordinate.fromLngLat([longitude, latitude], 0);
  const meterScale = anchorCoordinate.meterInMercatorCoordinateUnits();
  return {
    x: (point.x - anchorCoordinate.x) / meterScale,
    y: 0,
    z: -(point.y - anchorCoordinate.y) / meterScale,
  };
}

function disposeInstances(meshes) {
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    mesh.parent?.remove(mesh);
  }
}

export function createChargingStationLayer({
  minimumZoom = 15.5,
  detailZoom = ARCHITECTURAL_MODEL_PARAMETERS.detailZoom,
} = {}) {
  let map;
  let renderer;
  let camera;
  let scene;
  let simplifiedGroup;
  let detailedGroup;
  let simplifiedMeshes = [];
  let detailedMeshes = [];
  let stations = [];
  let stationIdToInstanceIndex = new Map();
  let modelReady = false;
  let rendererLost = false;
  let overlayVisible = true;
  let contextCanvas;
  let anchorCoordinate;
  let drawingBufferWidth = 0;
  let drawingBufferHeight = 0;

  function rebuildInstances() {
    if (!map || !modelReady || !scene) return;
    const center = map.getCenter();
    anchorCoordinate = mapboxgl.MercatorCoordinate.fromLngLat([center.lng, center.lat], 0);
    const meterScale = anchorCoordinate.meterInMercatorCoordinateUnits();
    const candidates = stations
      .filter(isValidStationPoint)
      .map(feature => {
        const [longitude, latitude] = feature.geometry.coordinates.map(Number);
        const point = mapboxgl.MercatorCoordinate.fromLngLat([longitude, latitude], 0);
        const dx = point.x - anchorCoordinate.x;
        const dy = point.y - anchorCoordinate.y;
        return {
          feature,
          localOffset: {
            x: dx / meterScale,
            y: 0,
            z: -dy / meterScale,
          },
          distance: dx * dx + dy * dy,
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_INSTANCES);

    stationIdToInstanceIndex = new Map();
    candidates.forEach(({ feature }, index) => {
      stationIdToInstanceIndex.set(stationId(feature, index), index);
    });

    const temporaryObject = new THREE.Object3D();
    for (const mesh of [...simplifiedMeshes, ...detailedMeshes]) {
      mesh.count = candidates.length;
      candidates.forEach(({ localOffset }, index) => {
        temporaryObject.position.set(
          localOffset.x,
          localOffset.y,
          localOffset.z
        );
        temporaryObject.rotation.set(0, 0, 0);
        temporaryObject.scale.setScalar(1);
        temporaryObject.updateMatrix();
        mesh.setMatrixAt(index, temporaryObject.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  function createInstances(model, targetGroup) {
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    if (Math.abs(bounds.min.y) > 0.001 ||
        Math.abs(bounds.max.y - ARCHITECTURAL_MODEL_PARAMETERS.totalHeightMeters) > 0.001) {
      throw new Error('Station tower model must start at ground level and measure exactly 400 metres.');
    }

    const instances = [];
    model.traverse(object => {
      if (!object.isMesh || !object.geometry || !object.material) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const instance = new THREE.InstancedMesh(geometry, object.material, MAX_INSTANCES);
      instance.count = 0;
      instance.frustumCulled = false;
      targetGroup.add(instance);
      instances.push(instance);
      object.geometry.dispose();
    });

    if (instances.length === 0) throw new Error('Architectural tower model contains no renderable meshes.');
    return instances;
  }

  function createModelInstances() {
    simplifiedMeshes = createInstances(
      createArchitecturalTower({ detail: 'simplified' }),
      simplifiedGroup
    );
    detailedMeshes = createInstances(
      createArchitecturalTower({ detail: 'full' }),
      detailedGroup
    );
    modelReady = true;
    rebuildInstances();
    map?.triggerRepaint();
  }

  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(currentMap, gl) {
      rendererLost = false;
      map = currentMap;
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      simplifiedGroup = new THREE.Group();
      detailedGroup = new THREE.Group();
      scene.add(simplifiedGroup, detailedGroup);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x75808a, 2.0));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
      keyLight.position.set(-20, 40, 30);
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
      createModelInstances();
    },
    render(_gl, matrix) {
      if (!renderer || !camera || !map || rendererLost || !modelReady) return;
      const zoom = map.getZoom();
      if (!overlayVisible || zoom < minimumZoom) return;

      simplifiedGroup.visible = zoom < detailZoom;
      detailedGroup.visible = !simplifiedGroup.visible;

      if (!anchorCoordinate) {
        const center = map.getCenter();
        anchorCoordinate = mapboxgl.MercatorCoordinate.fromLngLat([center.lng, center.lat], 0);
      }
      const canvas = map.getCanvas();
      if (canvas.width !== drawingBufferWidth || canvas.height !== drawingBufferHeight) {
        drawingBufferWidth = canvas.width;
        drawingBufferHeight = canvas.height;
        renderer.setPixelRatio(1);
        renderer.setSize(drawingBufferWidth, drawingBufferHeight, false);
      }
      const meterScale = anchorCoordinate.meterInMercatorCoordinateUnits();
      const modelMatrix = new THREE.Matrix4()
        .makeTranslation(anchorCoordinate.x, anchorCoordinate.y, anchorCoordinate.z)
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
      disposeInstances(simplifiedMeshes);
      disposeInstances(detailedMeshes);
      simplifiedMeshes = [];
      detailedMeshes = [];
      modelReady = false;
      renderer?.dispose();
      renderer = undefined;
      camera = undefined;
      scene = undefined;
      simplifiedGroup = undefined;
      detailedGroup = undefined;
      map = undefined;
      contextCanvas = undefined;
      anchorCoordinate = undefined;
      drawingBufferWidth = 0;
      drawingBufferHeight = 0;
    },
    setStations(features) {
      stations = Array.isArray(features) ? features : [];
      rebuildInstances();
      map?.triggerRepaint();
    },
    setVisible(visible) {
      overlayVisible = Boolean(visible);
      map?.triggerRepaint();
    },
    getStationInstanceIndex(id) {
      return stationIdToInstanceIndex.get(String(id));
    },
  };

  function handleContextLost() {
    rendererLost = true;
  }

  function handleContextRestored() {
    rendererLost = false;
    renderer?.resetState();
    map?.triggerRepaint();
  }
}
