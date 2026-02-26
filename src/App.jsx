/**
 * App.jsx — GTATO Crime Map
 * 
 * Root layout: sidebar filters + full-screen interactive crime map.
 * Manages filter state (crime types, date range) and passes to children.
 */
import { useState, useMemo } from 'react';
import CrimeMap from './components/CrimeMap';
import Sidebar from './components/Sidebar';
import { useCrimes } from './hooks/useCrimes';
import { CRIME_TYPE_KEYS } from './utils/crimeTypes';
import 'leaflet/dist/leaflet.css';
import './App.css';

function App() {
  // Filter state
  const [selectedTypes, setSelectedTypes] = useState([...CRIME_TYPE_KEYS]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Stable filter object for the hook
  const filters = useMemo(() => ({
    selectedTypes,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }), [selectedTypes, dateFrom, dateTo]);

  // Fetch crimes from Supabase with filters
  const { crimes, loading, error } = useCrimes(filters);

  /** Reset all filters to defaults */
  const handleReset = () => {
    setSelectedTypes([...CRIME_TYPE_KEYS]);
    setDateFrom('');
    setDateTo('');
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
        <CrimeMap crimes={crimes} />
      </main>
    </div>
  );
}

export default App;
