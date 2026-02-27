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

/**
 * Maps ArcGIS MCI_CATEGORY values to our normalized crime type keys.
 * Used by the data ingestion script.
 */
const MCI_CATEGORY_MAP = {
    'Assault': 'Assault',
    'Robbery': 'Theft',
    'Break and Enter': 'Break & Enter',
    'Auto Theft': 'Auto Theft',
    'Theft Over': 'Theft',
    'Homicide': 'Assault',
    'Shooting': 'Shooting',
};

/**
 * Normalize an ArcGIS MCI_CATEGORY string to one of our 5 crime types.
 */
export function normalizeCrimeType(mciCategory) {
    if (!mciCategory) return 'Theft';
    if (MCI_CATEGORY_MAP[mciCategory]) return MCI_CATEGORY_MAP[mciCategory];
    const lower = mciCategory.toLowerCase();
    if (lower.includes('assault')) return 'Assault';
    if (lower.includes('robbery') || lower.includes('theft')) return 'Theft';
    if (lower.includes('break') || lower.includes('enter')) return 'Break & Enter';
    if (lower.includes('auto')) return 'Auto Theft';
    if (lower.includes('shoot') || lower.includes('firearm')) return 'Shooting';
    if (lower.includes('homicide')) return 'Assault';
    return 'Theft';
}
