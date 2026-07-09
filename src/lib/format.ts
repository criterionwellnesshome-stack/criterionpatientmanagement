// Date formatting helpers — store as ISO (YYYY-MM-DD) but display as DD/MM/YYYY.

export const isoToDisplay = (iso?: string | null): string => {
  if (!iso) return "";
  // Accept ISO date or full timestamp
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
};

export const displayToIso = (display: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  if (isNaN(Date.parse(iso))) return null;
  return iso;
};

export const todayDisplay = (): string => isoToDisplay(new Date().toISOString().slice(0, 10));

// Short "DD Mon" format e.g. "26 Apr" for compact updated/follow-up cells.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const isoToDayMonth = (iso?: string | null): string => {
  if (!iso) return "";
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  const [, , mo, d] = m;
  const monthIdx = Number(mo) - 1;
  if (monthIdx < 0 || monthIdx > 11) return iso;
  return `${d} ${MONTHS[monthIdx]}`;
};
