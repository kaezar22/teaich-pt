// Conexión con el backend. La sesión del estudiante se guarda en este navegador.

const API = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
const CLAVE_SESION = "teaich-pt.sesion";

export function leerSesion() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_SESION)) || null;
  } catch {
    return null;
  }
}

export function guardarSesion(sesion) {
  try {
    if (sesion) localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    else localStorage.removeItem(CLAVE_SESION);
  } catch {
    /* sin almacenamiento: la sesión dura hasta cerrar la pestaña */
  }
}

export class ErrorApi extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.codigo = codigo;
  }
}

async function pedir(ruta, { metodo = "GET", cuerpo, token } = {}) {
  let r;
  try {
    r = await fetch(`${API}${ruta}`, {
      method: metodo,
      headers: {
        ...(cuerpo ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi("No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.", 0);
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorApi(datos.detail || `Error ${r.status}`, r.status);
  return datos;
}

export const api = {
  entrar: (pin) => pedir("/api/login", { metodo: "POST", cuerpo: { pin } }),
  curso: (token) => pedir("/api/curso", { token }),
  resultado: (token, datos) => pedir("/api/juegos/resultado", { metodo: "POST", cuerpo: datos, token }),
  latido: (token, actividad, practica_id) =>
    pedir("/api/practica/latido", { metodo: "POST", cuerpo: { actividad, practica_id }, token }),
  frases: (token, datos) => pedir("/api/practica/frases", { metodo: "POST", cuerpo: datos, token }),
  calificar: (token, datos) => pedir("/api/practica/calificar", { metodo: "POST", cuerpo: datos, token }),
  examen: (token, datos) => pedir("/api/examen/generar", { metodo: "POST", cuerpo: datos, token }),
  calificarExamen: (token, items) => pedir("/api/examen/calificar", { metodo: "POST", cuerpo: { items }, token }),
};

// Zona del profesor
const CLAVE_PROFE = "teaich-pt.profesor";

export function leerSesionProfe() {
  try {
    return localStorage.getItem(CLAVE_PROFE) || null;
  } catch {
    return null;
  }
}

export function guardarSesionProfe(token) {
  try {
    if (token) localStorage.setItem(CLAVE_PROFE, token);
    else localStorage.removeItem(CLAVE_PROFE);
  } catch {
    /* sin almacenamiento */
  }
}

// Descarga un archivo generado por el backend (Word, ZIP) y lo guarda en el computador
async function descargar(ruta, cuerpo, token, nombre) {
  let r;
  try {
    r = await fetch(`${API}${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi("No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.", 0);
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new ErrorApi(e.detail || `Error ${r.status}`, r.status);
  }
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const profe = {
  entrar: (clave) => pedir("/api/profesor/login", { metodo: "POST", cuerpo: { clave } }),
  dashboard: (token, dias) => pedir(`/api/profesor/dashboard?dias=${dias}`, { token }),
  estudiantes: (token) => pedir("/api/profesor/estudiantes", { token }),
  crearEstudiante: (token, datos) => pedir("/api/profesor/estudiantes", { metodo: "POST", cuerpo: datos, token }),
  activar: (token, id, activo) =>
    pedir(`/api/profesor/estudiantes/${encodeURIComponent(id)}/activo`, { metodo: "POST", cuerpo: { activo }, token }),
  resumen: (token) => pedir("/api/profesor/resumen", { token }),
  recargar: (token) => pedir("/api/profesor/recargar", { metodo: "POST", token }),
  cursos: (token) => pedir("/api/profesor/cursos", { token }),
  preguntas: (token, datos) => pedir("/api/profesor/material/preguntas", { metodo: "POST", cuerpo: datos, token }),
  docx: (token, datos, nombre) => descargar("/api/profesor/material/docx", datos, token, nombre),
  listening: (token, datos, nombre) => descargar("/api/profesor/material/listening", datos, token, nombre),
  completar: (token, datos) => pedir("/api/profesor/vocabulario/completar", { metodo: "POST", cuerpo: datos, token }),
  guardarVocabulario: (token, datos) => pedir("/api/profesor/vocabulario/guardar", { metodo: "POST", cuerpo: datos, token }),
};

// Chat: la respuesta llega por partes; `alRecibir` se llama con el texto acumulado
export async function chatear(token, datos, alRecibir) {
  let r;
  try {
    r = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(datos),
    });
  } catch {
    throw new ErrorApi("No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.", 0);
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new ErrorApi(e.detail || `Error ${r.status}`, r.status);
  }
  const lector = r.body.getReader();
  const decodificador = new TextDecoder();
  let texto = "";
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    texto += decodificador.decode(value, { stream: true });
    alRecibir(texto);
  }
  return texto;
}

// ---------------------------------------------------------------------------
// Audio: se pide al backend una vez y se reutiliza mientras la página esté abierta
// ---------------------------------------------------------------------------
const audios = new Map();

export function urlAudio(token, texto, { lento = false, voz = "femenina" } = {}) {
  const clave = `${voz}|${lento}|${texto}`;
  if (!audios.has(clave)) {
    const params = new URLSearchParams({ texto, voz, lento: String(lento) });
    const promesa = fetch(`${API}/api/audio?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new ErrorApi("No se pudo cargar el audio.", r.status);
        return r.blob();
      })
      .then((b) => URL.createObjectURL(b));
    promesa.catch(() => audios.delete(clave)); // si falla, se puede reintentar
    audios.set(clave, promesa);
  }
  return audios.get(clave);
}

let sonando = null;

export async function reproducir(token, texto, opciones) {
  const url = await urlAudio(token, texto, opciones);
  sonando?.pause();
  sonando = new Audio(url);
  await sonando.play();
}
