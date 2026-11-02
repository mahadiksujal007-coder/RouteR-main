import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createChargingStationLayer } from './charging-station-layer.js';

window.mapboxgl = mapboxgl;
window.createChargingStationLayer = createChargingStationLayer;
