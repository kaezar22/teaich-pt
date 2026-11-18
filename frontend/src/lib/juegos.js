// Reglas de los juegos de vocabulario (sin React, para poder probarlas aparte)

export const JUEGOS = {
  pt_es: {
    nombre: "Palavra → significado",
    descripcion: "Ves la palabra en portugués y eliges qué significa.",
    segundos: 6,
    cantidades: [5, 10, 15, 20],
  },
  es_pt: {
    nombre: "Significado → palavra",
    descripcion: "Ves la palabra en español y la escribes en portugués (con tildes).",
    segundos: 15,
    cantidades: [5, 10, 15, 20],
  },
  audio_pt: {
    nombre: "Audio → palavra",
    descripcion: "Escuchas la palabra y eliges cómo se escribe.",
    segundos: 9,
    cantidades: [5, 10, 15, 20],
  },
  parejas: {
    nombre: "Emparejar",
    descripcion: "Une cada palabra en portugués con su significado.",
    segundos: 5,
    cantidades: [4, 6, 8],
    unidad: "parejas",
  },
};

// Letras que no están en un teclado en español (o que cuesta escribir)
export const LETRAS_PT = ["á", "à", "â", "ã", "é", "ê", "í", "ó", "ô", "õ", "ú", "ç"];

export function barajar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sin tildes, sin mayúsculas, sin espacios ni puntuación
export const normal = (t) =>
  (t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]/g, "");

// Solo sin mayúsculas, espacios ni puntuación (conserva tildes y ç)
const limpio = (t) =>
  (t || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]/gu, "");

// "exacta", "tildes" (solo fallan tildes o ç) o "distinta". Si la palabra es "gostar de",
// también se acepta sin la preposición; "tudo bem?" sin el signo.
export function comparar(respuesta, palabra) {
  const opciones = [palabra, palabra.replace(/\s+(de|com|em)$/i, "")];
  if (opciones.some((o) => limpio(o) === limpio(respuesta))) return "exacta";
  if (opciones.some((o) => normal(o) === normal(respuesta))) return "tildes";
  return "distinta";
}

// Palabras únicas que se pueden usar en un juego
export function palabrasJugables(palabras, tipo) {
  const vistas = new Set();
  return palabras.filter((p) => {
    const clave = p.pt.toLowerCase();
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    if (tipo === "audio_pt") return true;
    // Escribir en portugués algo que se escribe igual en español no enseña nada (casa, banco)
    if (tipo === "es_pt" && limpio(p.es) === limpio(p.pt)) return false;
    return Boolean(p.es);
  });
}

// Preguntas de opción múltiple: la respuesta + hasta 3 distractores que no signifiquen lo mismo.
// En audio → palabra se prefieren distractores que se parezcan (misma primera letra).
export function crearPreguntas(palabras, cantidad, tipo = "pt_es") {
  const elegidas = barajar(palabras).slice(0, cantidad);
  return elegidas.map((correcta) => {
    let otras = palabras.filter(
      (p) => p.pt !== correcta.pt && (!p.es || normal(p.es) !== normal(correcta.es)),
    );
    if (tipo === "audio_pt") {
      const parecidas = otras.filter((p) => normal(p.pt)[0] === normal(correcta.pt)[0]);
      otras = [...barajar(parecidas), ...barajar(otras.filter((p) => !parecidas.includes(p)))];
    } else {
      otras = barajar(otras);
    }
    return { correcta, opciones: barajar([correcta, ...otras.slice(0, 3)]) };
  });
}

export function minimoPalabras(tipo) {
  return tipo === "parejas" ? 3 : tipo === "es_pt" ? 1 : 2;
}
