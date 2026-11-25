// Dates as YYYY-MM-DD in the browser's own time zone. new Date().toISOString() is in UTC, which is already
// "tomorrow" in the evening across the Americas (after 7 pm in New York), so a Started date set at 9 pm came out a day late.
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** The local date n days before today. */
export const localDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
};
