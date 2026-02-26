/**
 * Crime type definitions with colors and labels.
 * Used by map markers, sidebar legend, and filtering.
 */

export const CRIME_TYPES = {
    'Assault': {
        color: '#ef4444',    // Red
        bg: 'rgba(239, 68, 68, 0.15)',
        label: 'Assault',
        icon: '👊',
    },
    'Theft': {
        color: '#f59e0b',    // Amber
        bg: 'rgba(245, 158, 11, 0.15)',
        label: 'Theft',
        icon: '🧤',
    },
    'Shooting': {
        color: '#dc2626',    // Dark Red
        bg: 'rgba(220, 38, 38, 0.15)',
        label: 'Shooting',
        icon: '💥',
    },
    'Break & Enter': {
        color: '#8b5cf6',    // Purple
        bg: 'rgba(139, 92, 246, 0.15)',
        label: 'Break & Enter',
        icon: '🔓',
    },
    'Auto Theft': {
        color: '#3b82f6',    // Blue
        bg: 'rgba(59, 130, 246, 0.15)',
        label: 'Auto Theft',
        icon: '🚗',
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
