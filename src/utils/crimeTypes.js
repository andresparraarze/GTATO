/**
 * Crime type definitions with colors and labels.
 * Organized by city — each city has its own crime categories.
 *
 * Used by map markers, sidebar legend, and filtering.
 */

// ── City Configuration ────────────────────────────────────
export const CITY_CONFIG = {
    toronto: {
        key: 'toronto',
        name: 'GTA Toronto',
        flag: '🇨🇦',
        label: 'GTA Toronto 🇨🇦',
        subtitle: 'GTA Toronto Crime Map',
        center: [43.7417, -79.3733],
        zoom: 11,
        dataSource: 'City of Toronto Open Data',
    },
    santa_cruz: {
        key: 'santa_cruz',
        name: 'Santa Cruz',
        flag: '🇧🇴',
        label: 'Santa Cruz 🇧🇴',
        subtitle: 'Santa Cruz de la Sierra Crime Map',
        center: [-17.7833, -63.1821],
        zoom: 12,
        dataSource: 'Bolivian News Sources',
    },
};

export const CITY_KEYS = Object.keys(CITY_CONFIG);

// ── Toronto Crime Types ───────────────────────────────────
const TORONTO_CRIME_TYPES = {
    'Assault': {
        color: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.15)',
        label: 'Assault',
        icon: '👊',
    },
    'Auto Theft': {
        color: '#3b82f6',
        bg: 'rgba(59, 130, 246, 0.15)',
        label: 'Auto Theft',
        icon: '🚗',
    },
    'Bicycle Theft': {
        color: '#06b6d4',
        bg: 'rgba(6, 182, 212, 0.15)',
        label: 'Bicycle Theft',
        icon: '🚲',
    },
    'Break and Enter': {
        color: '#8b5cf6',
        bg: 'rgba(139, 92, 246, 0.15)',
        label: 'Break and Enter',
        icon: '🔓',
    },
    'Homicide': {
        color: '#18181b',
        bg: 'rgba(24, 24, 27, 0.25)',
        label: 'Homicide',
        icon: '💀',
    },
    'Robbery': {
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.15)',
        label: 'Robbery',
        icon: '💰',
    },
    'Sexual Violation': {
        color: '#ec4899',
        bg: 'rgba(236, 72, 153, 0.15)',
        label: 'Sexual Violation',
        icon: '⚠️',
    },
    'Shooting': {
        color: '#dc2626',
        bg: 'rgba(220, 38, 38, 0.15)',
        label: 'Shooting',
        icon: '💥',
    },
    'Theft from MV': {
        color: '#14b8a6',
        bg: 'rgba(20, 184, 166, 0.15)',
        label: 'Theft from MV',
        icon: '📦',
    },
    'Theft Over': {
        color: '#f97316',
        bg: 'rgba(249, 115, 22, 0.15)',
        label: 'Theft Over',
        icon: '🧤',
    },
};

// ── Santa Cruz Crime Types ────────────────────────────────
const SANTA_CRUZ_CRIME_TYPES = {
    'Homicidio': {
        color: '#18181b',
        bg: 'rgba(24, 24, 27, 0.25)',
        label: 'Homicidio',
        icon: '💀',
    },
    'Balacera': {
        color: '#dc2626',
        bg: 'rgba(220, 38, 38, 0.15)',
        label: 'Balacera',
        icon: '💥',
    },
    'Robo': {
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.15)',
        label: 'Robo',
        icon: '💰',
    },
    'Violación': {
        color: '#ec4899',
        bg: 'rgba(236, 72, 153, 0.15)',
        label: 'Violación',
        icon: '⚠️',
    },
    'Secuestro': {
        color: '#7c3aed',
        bg: 'rgba(124, 58, 237, 0.15)',
        label: 'Secuestro',
        icon: '🔒',
    },
    'Narcotráfico': {
        color: '#059669',
        bg: 'rgba(5, 150, 105, 0.15)',
        label: 'Narcotráfico',
        icon: '🧪',
    },
    'Extorsión': {
        color: '#d97706',
        bg: 'rgba(217, 119, 6, 0.15)',
        label: 'Extorsión',
        icon: '💸',
    },
    'Hurto': {
        color: '#0ea5e9',
        bg: 'rgba(14, 165, 233, 0.15)',
        label: 'Hurto',
        icon: '🧤',
    },
    'Violencia': {
        color: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.15)',
        label: 'Violencia',
        icon: '👊',
    },
    'Accidente': {
        color: '#6366f1',
        bg: 'rgba(99, 102, 241, 0.15)',
        label: 'Accidente',
        icon: '🚗',
    },
    'Incidente': {
        color: '#6b7280',
        bg: 'rgba(107, 114, 128, 0.15)',
        label: 'Incidente',
        icon: '📋',
    },
};

// ── Per-city maps ─────────────────────────────────────────
export const CRIME_TYPES_BY_CITY = {
    toronto: TORONTO_CRIME_TYPES,
    santa_cruz: SANTA_CRUZ_CRIME_TYPES,
};

// All crime types merged (for fallback color lookups)
const ALL_CRIME_TYPES = { ...TORONTO_CRIME_TYPES, ...SANTA_CRUZ_CRIME_TYPES };

// ── Legacy exports (Toronto defaults) ─────────────────────
export const CRIME_TYPES = TORONTO_CRIME_TYPES;
export const CRIME_TYPE_KEYS = Object.keys(TORONTO_CRIME_TYPES);

// ── City-aware helpers ────────────────────────────────────

export function getCrimeTypesForCity(city) {
    return CRIME_TYPES_BY_CITY[city] || TORONTO_CRIME_TYPES;
}

export function getCrimeTypeKeysForCity(city) {
    return Object.keys(getCrimeTypesForCity(city));
}

export function getCrimeColor(crimeType) {
    return ALL_CRIME_TYPES[crimeType]?.color ?? '#6b7280';
}
