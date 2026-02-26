/**
 * CrimeMap Component
 * 
 * Interactive Leaflet map centered on the Greater Toronto Area.
 * Renders crime markers with:
 * - Color-coded custom div icons by crime type
 * - MarkerClusterGroup for pin clustering
 * - Popup with crime details on click
 */
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import CrimePopup from './CrimePopup';
import { getCrimeColor, CRIME_TYPES } from '../utils/crimeTypes';

// Fix Leaflet's default icon paths for bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/** Toronto center coordinates */
const TORONTO_CENTER = [43.7417, -79.3733];
const DEFAULT_ZOOM = 11;

/**
 * Creates a custom colored circle marker icon for a crime type.
 */
function createCrimeIcon(crimeType) {
    const color = getCrimeColor(crimeType);
    const icon = CRIME_TYPES[crimeType]?.icon || '📍';

    return L.divIcon({
        className: 'crime-marker',
        html: `
      <div class="crime-marker__pin" style="
        background: ${color};
        box-shadow: 0 0 12px ${color}88, 0 2px 8px rgba(0,0,0,0.4);
      ">
        <span class="crime-marker__icon">${icon}</span>
      </div>
      <div class="crime-marker__pulse" style="background: ${color};"></div>
    `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20],
    });
}

/**
 * Custom cluster icon that shows the count with a gradient.
 */
function createClusterIcon(cluster) {
    const count = cluster.getChildCount();
    let size = 'small';
    if (count >= 50) size = 'large';
    else if (count >= 10) size = 'medium';

    return L.divIcon({
        html: `<div class="cluster-icon cluster-icon--${size}"><span>${count}</span></div>`,
        className: 'custom-cluster',
        iconSize: L.point(44, 44),
    });
}

export default function CrimeMap({ crimes }) {
    return (
        <div className="crime-map">
            <MapContainer
                center={TORONTO_CENTER}
                zoom={DEFAULT_ZOOM}
                className="crime-map__container"
                zoomControl={false}
            >
                {/* Dark-themed CartoDB tiles */}
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />

                {/* Clustered crime markers */}
                <MarkerClusterGroup
                    chunkedLoading
                    iconCreateFunction={createClusterIcon}
                    maxClusterRadius={60}
                    spiderfyOnMaxZoom
                    showCoverageOnHover={false}
                    disableClusteringAtZoom={16}
                >
                    {crimes.map((crime) => (
                        <Marker
                            key={crime.id}
                            position={[crime.latitude, crime.longitude]}
                            icon={createCrimeIcon(crime.crime_type)}
                        >
                            <Popup className="crime-popup-wrapper" maxWidth={320} minWidth={260}>
                                <CrimePopup crime={crime} />
                            </Popup>
                        </Marker>
                    ))}
                </MarkerClusterGroup>
            </MapContainer>
        </div>
    );
}
