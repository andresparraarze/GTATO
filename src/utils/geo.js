/**
 * Geo utilities for distance calculations.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Haversine formula — distance in km between two lat/lng points.
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Filter crimes within a given radius (km) of a center point.
 * Returns a new array of crimes that are within the radius.
 */
export function filterCrimesInRadius(crimes, center, radiusKm) {
    if (!center || !radiusKm) return crimes;
    return crimes.filter((c) => {
        if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return false;
        return haversineDistance(center.lat, center.lng, c.lat, c.lng) <= radiusKm;
    });
}

/** Available radius options in km */
export const RADIUS_OPTIONS = [1, 2, 5, 10];
