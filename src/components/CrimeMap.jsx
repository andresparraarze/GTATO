/**
 * CrimeMap Component
 *
 * Interactive Leaflet map with multi-city support.
 * Re-centers and re-zooms when the selected city changes.
 * Renders crime markers with:
 * - Color-coded custom div icons by crime type
 * - MarkerClusterGroup for pin clustering
 * - Popup with crime details on click
 * - User location marker with pulsing animation
 * - Radius circle overlay
 * - "Center on my location" button
 */
import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import CrimePopup from './CrimePopup';
import { getCrimeColor, getCrimeTypesForCity, CITY_CONFIG } from '../utils/crimeTypes';

// Fix Leaflet's default icon paths for bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/** Default center and zoom (Toronto) */
const DEFAULT_CENTER = [43.7417, -79.3733];
const DEFAULT_ZOOM = 11;

/**
 * Creates a custom colored circle marker icon for a crime type.
 */
function createCrimeIcon(crimeType, city) {
    const color = getCrimeColor(crimeType);
    const types = getCrimeTypesForCity(city);
    const icon = types[crimeType]?.icon || '📍';

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
 * "You are here" pulsing blue marker icon.
 */
const userLocationIcon = L.divIcon({
    className: 'user-location-marker',
    html: `
    <div class="user-marker__dot"></div>
    <div class="user-marker__pulse"></div>
    <div class="user-marker__pulse user-marker__pulse--delayed"></div>
  `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
});

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

/**
 * Inner component to handle map centering and city changes.
 */
function MapController({ userLocation, city, mapRef }) {
    const map = useMap();

    // Store map reference for external use
    useEffect(() => {
        if (mapRef) mapRef.current = map;
    }, [map, mapRef]);

    // Re-center map when city changes
    useEffect(() => {
        const cfg = CITY_CONFIG[city];
        if (cfg) {
            map.setView(cfg.center, cfg.zoom, { animate: true });
        }
    }, [city, map]);

    // Center on user location once when it first becomes available
    useEffect(() => {
        if (userLocation) {
            map.setView([userLocation.lat, userLocation.lng], 13, { animate: true });
        }
    }, [userLocation]); // eslint-disable-line react-hooks/exhaustive-deps

    return null;
}

export default function CrimeMap({ crimes, city, userLocation, radiusKm }) {
    const mapRef = useRef(null);

    const handleCenterOnUser = () => {
        if (userLocation && mapRef.current) {
            mapRef.current.setView([userLocation.lat, userLocation.lng], 14, { animate: true });
        }
    };

    return (
        <div className="crime-map">
            <MapContainer
                center={DEFAULT_CENTER}
                zoom={DEFAULT_ZOOM}
                className="crime-map__container"
                zoomControl={false}
            >
                <MapController userLocation={userLocation} city={city} mapRef={mapRef} />

                {/* Dark-themed CartoDB tiles */}
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />

                {/* User location marker + radius circle */}
                {userLocation && (
                    <>
                        <Marker
                            position={[userLocation.lat, userLocation.lng]}
                            icon={userLocationIcon}
                            zIndexOffset={1000}
                        >
                            <Popup className="crime-popup-wrapper">
                                <div className="crime-popup" style={{ textAlign: 'center' }}>
                                    <span style={{ fontSize: '1.5rem' }}>📍</span>
                                    <p style={{ marginTop: 4, fontWeight: 600 }}>You are here</p>
                                </div>
                            </Popup>
                        </Marker>
                        <Circle
                            center={[userLocation.lat, userLocation.lng]}
                            radius={radiusKm * 1000}
                            pathOptions={{
                                color: '#60a5fa',
                                fillColor: '#60a5fa',
                                fillOpacity: 0.06,
                                weight: 1.5,
                                dashArray: '6 4',
                            }}
                        />
                    </>
                )}

                {/* Clustered crime markers */}
                <MarkerClusterGroup
                    chunkedLoading
                    iconCreateFunction={createClusterIcon}
                    maxClusterRadius={60}
                    spiderfyOnMaxZoom
                    showCoverageOnHover={false}
                    disableClusteringAtZoom={16}
                >
                    {crimes
                        .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number' && isFinite(c.lat) && isFinite(c.lng))
                        .map((crime) => (
                            <Marker
                                key={crime.id}
                                position={[crime.lat, crime.lng]}
                                icon={createCrimeIcon(crime.crime_type, city)}
                            >
                                <Popup className="crime-popup-wrapper" maxWidth={320} minWidth={260}>
                                    <CrimePopup crime={crime} />
                                </Popup>
                            </Marker>
                        ))}
                </MarkerClusterGroup>
            </MapContainer>

            {/* Center on my location button */}
            {userLocation && (
                <button
                    className="center-on-me"
                    onClick={handleCenterOnUser}
                    title="Center on my location"
                    aria-label="Center on my location"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <line x1="12" y1="2" x2="12" y2="6" />
                        <line x1="12" y1="18" x2="12" y2="22" />
                        <line x1="2" y1="12" x2="6" y2="12" />
                        <line x1="18" y1="12" x2="22" y2="12" />
                    </svg>
                </button>
            )}
        </div>
    );
}
