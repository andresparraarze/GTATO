/**
 * App.jsx — GTATO Crime Map
 *
 * Root layout: sidebar filters + full-screen interactive crime map.
 * Manages filter state (crime types, date range, radius) and passes to children.
 * Supports multi-city switching (Toronto / Santa Cruz de la Sierra).
 */
import { useState, useMemo, useCallback } from 'react';
import CrimeMap from './components/CrimeMap';
import Sidebar from './components/Sidebar';
import { useCrimes } from './hooks/useCrimes';
import { useUserLocation } from './hooks/useUserLocation';
import { getCrimeTypeKeysForCity } from './utils/crimeTypes';
import { filterCrimesInRadius } from './utils/geo';
import 'leaflet/dist/leaflet.css';
import './App.css';

function App() {
  // City state
  const [city, setCity] = useState('toronto');

  // Filter state
  const [selectedTypes, setSelectedTypes] = useState([...getCrimeTypeKeysForCity('toronto')]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [radiusKm, setRadiusKm] = useState(2);

  // User geolocation
  const { location: userLocation, error: locationError } = useUserLocation();

  // Handle city switch — reset crime type filters to match new city
  const handleCityChange = useCallback((newCity) => {
    setCity(newCity);
    setSelectedTypes([...getCrimeTypeKeysForCity(newCity)]);
    setDateFrom('');
    setDateTo('');
  }, []);

  // Stable filter object for the hook
  const filters = useMemo(() => ({
    selectedTypes,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    city,
  }), [selectedTypes, dateFrom, dateTo, city]);

  // Fetch crimes from Supabase with filters
  const { crimes, loading, error, lastUpdated } = useCrimes(filters);

  // Compute nearby crime count
  const nearbyCrimeCount = useMemo(() => {
    if (!userLocation) return 0;
    return filterCrimesInRadius(crimes, userLocation, radiusKm).length;
  }, [crimes, userLocation, radiusKm]);

  /** Reset all filters to defaults */
  const handleReset = () => {
    setSelectedTypes([...getCrimeTypeKeysForCity(city)]);
    setDateFrom('');
    setDateTo('');
    setRadiusKm(2);
  };

  return (
    <div className="app">
      <Sidebar
        city={city}
        onCityChange={handleCityChange}
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
          city={city}
          userLocation={userLocation}
          radiusKm={radiusKm}
        />
      </main>
    </div>
  );
}

export default App;
