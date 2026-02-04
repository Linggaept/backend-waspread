/**
 * Timezone Utility
 * 
 * BEST PRACTICE: Backend stores UTC, Frontend converts.
 * 
 * - Backend: Store all dates in UTC (using new Date())
 * - API Response: Send dates as ISO strings (UTC)
 * - Frontend: Convert UTC to user's timezone for display
 * 
 * This file provides utility functions for date operations.
 * Since we're using UTC, most functions are simple wrappers.
 */

/**
 * Get current date/time in UTC
 * This is the standard way to get current time for storage
 */
export function getCurrentDate(): Date {
  return new Date();
}

/**
 * Get current timestamp as ISO string (UTC)
 * Use this for API responses
 */
export function getISOString(): string {
  return new Date().toISOString();
}

/**
 * Get current year (UTC)
 */
export function getCurrentYear(): number {
  return new Date().getUTCFullYear();
}

/**
 * Get today's date as YYYY-MM-DD string (UTC)
 */
export function getTodayString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * DEPRECATED: These Indonesia-specific functions are kept for backwards compatibility
 * but should be removed once frontend handles timezone conversion.
 */

const INDONESIA_TIMEZONE = 'Asia/Jakarta';

/**
 * @deprecated Use frontend to convert UTC to Indonesia timezone
 */
export function formatToIndonesia(date: Date): string {
  return date.toLocaleString('id-ID', { timeZone: INDONESIA_TIMEZONE });
}
