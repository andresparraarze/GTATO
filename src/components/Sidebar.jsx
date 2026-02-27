/**
 * Sidebar Component
 *
 * Filter panel with:
 * - Crime type checkboxes (colored indicators)
 * - Date range picker (from/to)
 * - Proximity section (radius selector + nearby count)
 * - Reset filters button
 * - Crime count summary
 */
import { CRIME_TYPES, CRIME_TYPE_KEYS } from '../utils/crimeTypes';
import { RADIUS_OPTIONS } from '../utils/geo';

export default function Sidebar({
    selectedTypes,
    onTypesChange,
    dateFrom,
    dateTo,
    onDateFromChange,
    onDateToChange,
    onReset,
    crimeCount,
    loading,
    isOpen,
    onToggle,
    /* Location props */
    userLocation,
    locationError,
    radiusKm,
    onRadiusChange,
    nearbyCrimeCount,
    lastUpdated,
}) {
    /** Format a relative time string like "2 hours ago" */
    const formatTimeAgo = (isoString) => {
        if (!isoString) return null;
        const diff = Date.now() - new Date(isoString).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    };
    /** Toggle a single crime type in the selected set */
    const handleTypeToggle = (type) => {
        if (selectedTypes.includes(type)) {
            onTypesChange(selectedTypes.filter((t) => t !== type));
        } else {
            onTypesChange([...selectedTypes, type]);
        }
    };

    /** Select / deselect all types */
    const handleSelectAll = () => {
        if (selectedTypes.length === CRIME_TYPE_KEYS.length) {
            onTypesChange([]);
        } else {
            onTypesChange([...CRIME_TYPE_KEYS]);
        }
    };

    return (
        <>
            {/* Mobile toggle button */}
            <button
                className={`sidebar-toggle ${isOpen ? 'sidebar-toggle--open' : ''}`}
                onClick={onToggle}
                aria-label="Toggle filters"
            >
                <span className="sidebar-toggle__icon">{isOpen ? '✕' : '☰'}</span>
            </button>

            <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
                {/* Header */}
                <div className="sidebar__header">
                    <div className="sidebar__logo">
                        <span className="sidebar__logo-icon">🗺️</span>
                        <h1 className="sidebar__title">GTATO</h1>
                    </div>
                    <p className="sidebar__subtitle">GTA Toronto Crime Map</p>
                </div>

                {/* Crime count */}
                <div className="sidebar__count">
                    {loading ? (
                        <div className="sidebar__count-loading">
                            <span className="spinner" /> Loading…
                        </div>
                    ) : (
                        <>
                            <span className="sidebar__count-number">{crimeCount}</span>
                            <span className="sidebar__count-label">incidents shown</span>
                        </>
                    )}
                </div>

                {/* Data freshness indicator */}
                {lastUpdated && (
                    <div className="sidebar__freshness">
                        <span className="sidebar__freshness-dot" />
                        <span className="sidebar__freshness-text">
                            Updated {formatTimeAgo(lastUpdated)}
                        </span>
                    </div>
                )}

                {/* ── Proximity Section ────────────────────── */}
                <div className="sidebar__section sidebar__proximity">
                    <h2 className="sidebar__section-title">📍 Proximity</h2>

                    {userLocation ? (
                        <>
                            {/* Nearby count */}
                            <div className="proximity__count">
                                <span className="proximity__count-number">{nearbyCrimeCount}</span>
                                <span className="proximity__count-label">
                                    incidents within {radiusKm}km
                                </span>
                            </div>

                            {/* Radius selector */}
                            <div className="proximity__radius">
                                <span className="proximity__radius-label">Radius</span>
                                <div className="proximity__options">
                                    {RADIUS_OPTIONS.map((r) => (
                                        <button
                                            key={r}
                                            className={`proximity__option ${radiusKm === r ? 'proximity__option--active' : ''}`}
                                            onClick={() => onRadiusChange(r)}
                                        >
                                            {r}km
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="proximity__fallback">
                            <span className="proximity__fallback-icon">🔒</span>
                            <p className="proximity__fallback-text">
                                {locationError || 'Enable location for personalized view'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Crime Type Filters */}
                <div className="sidebar__section">
                    <div className="sidebar__section-header">
                        <h2 className="sidebar__section-title">Crime Type</h2>
                        <button className="sidebar__select-all" onClick={handleSelectAll}>
                            {selectedTypes.length === CRIME_TYPE_KEYS.length
                                ? 'Deselect all'
                                : 'Select all'}
                        </button>
                    </div>

                    <div className="sidebar__types">
                        {CRIME_TYPE_KEYS.map((type) => {
                            const info = CRIME_TYPES[type];
                            const isChecked = selectedTypes.includes(type);
                            return (
                                <label key={type} className="sidebar__type-item">
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => handleTypeToggle(type)}
                                        className="sidebar__checkbox"
                                    />
                                    <span
                                        className="sidebar__type-dot"
                                        style={{ backgroundColor: info.color }}
                                    />
                                    <span className="sidebar__type-icon">{info.icon}</span>
                                    <span className="sidebar__type-label">{info.label}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>

                {/* Date Range Filters */}
                <div className="sidebar__section">
                    <h2 className="sidebar__section-title">Date Range</h2>
                    <div className="sidebar__dates">
                        <label className="sidebar__date-field">
                            <span className="sidebar__date-label">From</span>
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => onDateFromChange(e.target.value)}
                                className="sidebar__date-input"
                            />
                        </label>
                        <label className="sidebar__date-field">
                            <span className="sidebar__date-label">To</span>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => onDateToChange(e.target.value)}
                                className="sidebar__date-input"
                            />
                        </label>
                    </div>
                </div>

                {/* Reset Button */}
                <button className="sidebar__reset" onClick={onReset}>
                    ↺ Reset All Filters
                </button>

                {/* Footer */}
                <div className="sidebar__footer">
                    <p>Data: Toronto Police Service Open Data</p>
                    <p>Built with React + Leaflet + Supabase</p>
                </div>
            </aside>
        </>
    );
}
