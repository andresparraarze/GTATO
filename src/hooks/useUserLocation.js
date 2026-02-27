/**
 * useUserLocation Hook
 *
 * Requests the user's geolocation on mount.
 * Returns { location, loading, error, refresh }.
 *
 * - location: { lat, lng } | null
 * - error: string | null  (e.g. "User denied Geolocation")
 * - loading: boolean
 * - refresh: () => void  (re-request location)
 */
import { useState, useEffect, useCallback } from 'react';

export function useUserLocation() {
    const [location, setLocation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const requestLocation = useCallback(() => {
        if (!navigator.geolocation) {
            setError('Geolocation is not supported by your browser.');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                setLocation({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                });
                setLoading(false);
            },
            (err) => {
                let message;
                switch (err.code) {
                    case err.PERMISSION_DENIED:
                        message = 'Location access denied.';
                        break;
                    case err.POSITION_UNAVAILABLE:
                        message = 'Location unavailable.';
                        break;
                    case err.TIMEOUT:
                        message = 'Location request timed out.';
                        break;
                    default:
                        message = 'An unknown error occurred.';
                }
                setError(message);
                setLoading(false);
            },
            {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 300000, // cache for 5 minutes
            }
        );
    }, []);

    useEffect(() => {
        requestLocation();
    }, [requestLocation]);

    return { location, loading, error, refresh: requestLocation };
}
