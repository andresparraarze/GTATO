/**
 * App.jsx — GTATO Crime Map
 *
 * Root layout: sidebar filters + full-screen interactive crime map.
 * Manages filter state (crime types, date range, radius) and passes to children.
 * Integrates user geolocation for proximity features.
 */
import { useState, useMemo } from 'react';
import CrimeMap from './components/CrimeMap';
import Sidebar from './components/Sidebar';
import { useCrimes } from './hooks/useCrimes';
import { useUserLocation } from './hooks/useUserLocation';
import { CRIME_TYPE_KEYS } from './utils/crimeTypes';
import { filterCrimesInRadius } from './utils/geo';
import 'leaflet/dist/leaflet.css';
import './App.css';

function App() {
  // Filter state
  const [selectedTypes, setSelectedTypes] = useState([...CRIME_TYPE_KEYS]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [radiusKm, setRadiusKm] = useState(2);

  // User geolocation
  const { location: userLocation, error: locationError } = useUserLocation();

  // Stable filter object for the hook
  const filters = useMemo(() => ({
    selectedTypes,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }), [selectedTypes, dateFrom, dateTo]);

  // Fetch crimes from Supabase with filters
  const { crimes, loading, error, lastUpdated } = useCrimes(filters);

  // Compute nearby crime count
  const nearbyCrimeCount = useMemo(() => {
    if (!userLocation) return 0;
    return filterCrimesInRadius(crimes, userLocation, radiusKm).length;
  }, [crimes, userLocation, radiusKm]);

  /** Reset all filters to defaults */
  const handleReset = () => {
    setSelectedTypes([...CRIME_TYPE_KEYS]);
    setDateFrom('');
    setDateTo('');
    setRadiusKm(2);
  };

  return (
    <div className="app">
      <Sidebar
        selectedTypes={selectedTypes}
        onTypesChange={setSelectedTypes}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onReset={handleReset}
        crimeCount={crimes.length}
        loading={loading}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        /* Location props */
        userLocation={userLocation}
        locationError={locationError}
        radiusKm={radiusKm}
        onRadiusChange={setRadiusKm}
        nearbyCrimeCount={nearbyCrimeCount}
        lastUpdated={lastUpdated}
      />

      <main className={`app__main ${sidebarOpen ? '' : 'app__main--expanded'}`}>
        {error && (
          <div className="app__error">
            <p>⚠️ Failed to load crime data: {error}</p>
            <p className="app__error-hint">
              Check your Supabase credentials in <code>.env.local</code>
            </p>
          </div>
        )}
        <CrimeMap
          crimes={crimes}
          userLocation={userLocation}
          radiusKm={radiusKm}
        />
      </main>
    </div>
  );
}

export default App;
