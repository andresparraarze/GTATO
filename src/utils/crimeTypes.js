/**
 * Crime type definitions with colors and labels.
 * Used by map markers, sidebar legend, and filtering.
 *
 * Keys match the exact MCI_CATEGORY values from the
 * City of Toronto CKAN API (plus "Shooting" from the
 * Shootings & Firearm Discharges dataset).
 */

export const CRIME_TYPES = {
    'Assault': {
        color: '#ef4444',    // Red
        bg: 'rgba(239, 68, 68, 0.15)',
        label: 'Assault',
        icon: '👊',
    },
    'Auto Theft': {
        color: '#3b82f6',    // Blue
        bg: 'rgba(59, 130, 246, 0.15)',
        label: 'Auto Theft',
        icon: '🚗',
    },
    'Bicycle Theft': {
        color: '#06b6d4',    // Cyan
        bg: 'rgba(6, 182, 212, 0.15)',
        label: 'Bicycle Theft',
        icon: '🚲',
    },
    'Break and Enter': {
        color: '#8b5cf6',    // Purple
        bg: 'rgba(139, 92, 246, 0.15)',
        label: 'Break and Enter',
        icon: '🔓',
    },
    'Homicide': {
        color: '#18181b',    // Black
        bg: 'rgba(24, 24, 27, 0.25)',
        label: 'Homicide',
        icon: '💀',
    },
    'Robbery': {
        color: '#f59e0b',    // Amber
        bg: 'rgba(245, 158, 11, 0.15)',
        label: 'Robbery',
        icon: '💰',
    },
    'Sexual Violation': {
        color: '#ec4899',    // Pink
        bg: 'rgba(236, 72, 153, 0.15)',
        label: 'Sexual Violation',
        icon: '⚠️',
    },
    'Shooting': {
        color: '#dc2626',    // Dark Red
        bg: 'rgba(220, 38, 38, 0.15)',
        label: 'Shooting',
        icon: '💥',
    },
    'Theft from MV': {
        color: '#14b8a6',    // Teal
        bg: 'rgba(20, 184, 166, 0.15)',
        label: 'Theft from MV',
        icon: '📦',
    },
    'Theft Over': {
        color: '#f97316',    // Orange
        bg: 'rgba(249, 115, 22, 0.15)',
        label: 'Theft Over',
        icon: '🧤',
    },
};

/** All crime type keys as an array */
export const CRIME_TYPE_KEYS = Object.keys(CRIME_TYPES);

/**
 * Returns the marker color for a given crime type.
 * Falls back to gray if the type isn't recognized.
 */
export function getCrimeColor(crimeType) {
    return CRIME_TYPES[crimeType]?.color ?? '#6b7280';
}
