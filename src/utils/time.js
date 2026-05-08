const TIMEZONE = 'America/Sao_Paulo';

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});

const dayMonthFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  timeZone: TIMEZONE,
});

const monthYearFormatter = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
  timeZone: TIMEZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});

const saoPauloDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIMEZONE,
});

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatTimeSP(value) {
  const date = toDate(value);
  return timeFormatter.format(date);
}

export function formatDayMonthSP(value) {
  const date = toDate(value);
  return dayMonthFormatter.format(date);
}

export function formatMonthYearSP(value) {
  const date = toDate(value);
  return monthYearFormatter.format(date);
}

export function formatDateTimeSP(value) {
  const date = toDate(value);
  return dateTimeFormatter.format(date);
}

export function getSaoPauloDateKey(value) {
  const date = toDate(value);
  return saoPauloDateKeyFormatter.format(date);
}

export function getDateKeyFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export const APP_TIMEZONE = TIMEZONE;
