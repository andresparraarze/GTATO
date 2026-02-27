/**
 * useCrimes Hook
 * 
 * Fetches crime incidents from Supabase with optional filtering
 * by crime type and date range. Returns { crimes, loading, error }.
 * Gracefully handles missing Supabase configuration.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

export function useCrimes(filters = {}) {
    const [crimes, setCrimes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    const { selectedTypes, dateFrom, dateTo, city } = filters;

    const fetchCrimes = useCallback(async () => {
        // If Supabase isn't configured, return empty with a helpful message
        if (!isSupabaseConfigured || !supabase) {
            setLoading(false);
            setError('Supabase not configured. Add your credentials to .env.local and restart.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            let query = supabase
                .from('crimes')
                .select('*')
                .order('date_reported', { ascending: false })
                .eq('city', city || 'toronto');

            // Filter by crime types (if not all selected)
            if (selectedTypes && selectedTypes.length > 0) {
                query = query.in('crime_type', selectedTypes);
            }

            // Filter by date range
            if (dateFrom) {
                query = query.gte('date_reported', dateFrom);
            }
            if (dateTo) {
                const toDate = new Date(dateTo);
                toDate.setDate(toDate.getDate() + 1);
                query = query.lt('date_reported', toDate.toISOString());
            }

            const { data, error: queryError } = await query;

            if (queryError) throw queryError;

            // Debug: log the first crime object to verify column names
            if (data?.length > 0) {
                console.log('[GTATO] First crime object from Supabase:', data[0]);
            }

            setCrimes(data || []);

            // Extract the most recent last_updated timestamp
            if (data?.length > 0) {
                const timestamps = data
                    .map(d => d.last_updated)
                    .filter(Boolean)
                    .sort()
                    .reverse();
                if (timestamps.length > 0) setLastUpdated(timestamps[0]);
            }
        } catch (err) {
            console.error('Error fetching crimes:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [selectedTypes, dateFrom, dateTo, city]);

    useEffect(() => {
        fetchCrimes();
    }, [fetchCrimes]);

    return { crimes, loading, error, lastUpdated, refetch: fetchCrimes };
}
