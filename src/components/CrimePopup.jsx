/**
 * CrimePopup Component
 * 
 * Renders the styled popup content when a crime marker is clicked.
 * Shows crime type badge, date/time, address, description, and source.
 */
import { format } from 'date-fns';
import { CRIME_TYPES } from '../utils/crimeTypes';

export default function CrimePopup({ crime }) {
    const typeInfo = CRIME_TYPES[crime.crime_type] || {};
    const dateStr = format(new Date(crime.date_reported), 'MMM d, yyyy — h:mm a');

    return (
        <div className="crime-popup">
            {/* Crime type badge */}
            <span
                className="crime-popup__badge"
                style={{
                    backgroundColor: typeInfo.bg || 'rgba(107,114,128,0.15)',
                    color: typeInfo.color || '#6b7280',
                    borderColor: typeInfo.color || '#6b7280',
                }}
            >
                {typeInfo.icon} {crime.crime_type}
            </span>

            {/* Date & time */}
            <p className="crime-popup__date">{dateStr}</p>

            {/* Address */}
            {crime.address && (
                <p className="crime-popup__address">
                    📍 {crime.address}
                </p>
            )}

            {/* Neighbourhood */}
            {crime.neighbourhood && (
                <p className="crime-popup__neighbourhood">
                    🏘️ {crime.neighbourhood}
                </p>
            )}

            {/* Description */}
            {crime.description && (
                <p className="crime-popup__desc">{crime.description}</p>
            )}

            {/* Source link */}
            {crime.source_url && (
                <a
                    href={crime.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="crime-popup__source"
                >
                    View source →
                </a>
            )}
        </div>
    );
}
