// Formatos de tiempo y fecha para el dashboard

export function duracion(seg) {
  if (!seg) return "0 min";
  if (seg < 60) return "menos de 1 min";
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, "0")} min`;
}

const FECHA = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });
const HORA = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });

// Días de calendario (en la hora local del navegador) entre la fecha y hoy
function diasDesde(fecha, ahora = new Date()) {
  const inicio = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((inicio(ahora) - inicio(fecha)) / 86_400_000);
}

export function haceCuanto(iso, ahora = new Date()) {
  if (!iso) return "Nunca";
  const d = new Date(iso);
  const dias = diasDesde(d, ahora);
  if (dias <= 0) return `Hoy, ${HORA.format(d)}`;
  if (dias === 1) return `Ayer, ${HORA.format(d)}`;
  if (dias < 7) return `Hace ${dias} días`;
  return FECHA.format(d);
}

export function diaCorto(isoFecha) {
  // isoFecha = "2026-10-19" (día local del servidor); se lee como fecha sin hora
  const [a, m, d] = isoFecha.split("-").map(Number);
  return FECHA.format(new Date(a, m - 1, d));
}

export const ACTIVIDADES = {
  vocabulario: "Vocabulario",
  juego: "Juegos",
  es_pt: "Español → Portugués",
  pt_es: "Portugués → Español",
  escucha: "Listening",
  chat: "Tutora",
  examen: "Examen",
};
