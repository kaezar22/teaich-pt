import { useState } from "react";
import { reproducir } from "../api.js";
import { JUEGOS, minimoPalabras, palabrasJugables } from "../lib/juegos.js";
import { usePractica } from "../lib/usePractica.js";

const CLAVE_JUEGO = "teaich-pt.juego";

function leerPreferencia() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_JUEGO)) || {};
  } catch {
    return {};
  }
}

export default function Vocabulario({ palabras, token, jugar }) {
  usePractica(token, "vocabulario");
  const previa = leerPreferencia();
  const [tipo, setTipo] = useState(JUEGOS[previa.tipo] ? previa.tipo : "pt_es");
  const [cantidades, setCantidades] = useState(previa.cantidades || {});
  const [sonando, setSonando] = useState(null);
  const [errorAudio, setErrorAudio] = useState("");

  const juego = JUEGOS[tipo];
  const jugables = palabrasJugables(palabras, tipo);
  const opciones = juego.cantidades.filter((n, i) => n <= jugables.length || i === 0);
  const cantidad = Math.min(
    opciones.includes(cantidades[tipo]) ? cantidades[tipo] : opciones[Math.min(1, opciones.length - 1)],
    jugables.length,
  );
  const alcanza = jugables.length >= minimoPalabras(tipo);

  function guardar(t, c) {
    try {
      localStorage.setItem(CLAVE_JUEGO, JSON.stringify({ tipo: t, cantidades: c }));
    } catch {
      /* no pasa nada */
    }
  }

  async function oir(p) {
    setSonando(p.pt);
    setErrorAudio("");
    try {
      await reproducir(token, p.pt, { lento: true });
    } catch {
      setErrorAudio("No se pudo reproducir el audio. Inténtalo de nuevo.");
    } finally {
      setSonando(null);
    }
  }

  return (
    <>
      <section className="lanzador" aria-labelledby="titulo-juegos">
        <h1 id="titulo-juegos">Practica con un juego</h1>
        <div className="tipos-juego" role="radiogroup" aria-label="Juego">
          {Object.entries(JUEGOS).map(([clave, j]) => (
            <button
              key={clave}
              role="radio"
              aria-checked={clave === tipo}
              className={clave === tipo ? "tipo-juego activo" : "tipo-juego"}
              onClick={() => {
                setTipo(clave);
                guardar(clave, cantidades);
              }}
            >
              <strong>{j.nombre}</strong>
              <span>{j.descripcion}</span>
            </button>
          ))}
        </div>
        <div className="config-juego">
          <div className="cantidades" role="radiogroup" aria-label={juego.unidad === "parejas" ? "Número de parejas" : "Número de preguntas"}>
            <span>{juego.unidad === "parejas" ? "Parejas" : "Preguntas"}</span>
            {opciones.map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={n === cantidad}
                className={n === cantidad ? "cantidad activa" : "cantidad"}
                onClick={() => {
                  const c = { ...cantidades, [tipo]: n };
                  setCantidades(c);
                  guardar(tipo, c);
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="tiempo-juego">Tiempo: {cantidad * juego.segundos} s</span>
          <button className="boton" disabled={!alcanza} onClick={() => jugar(tipo, jugables, cantidad)}>
            Empezar
          </button>
        </div>
        {!alcanza && (
          <p className="aviso">Elige más unidades: este juego necesita al menos {minimoPalabras(tipo)} palabras con significado.</p>
        )}
      </section>

      <section aria-labelledby="titulo-vocab">
        <div className="titulo-seccion">
          <h2 id="titulo-vocab">Mi vocabulario</h2>
          <span>Toca una palabra para escucharla</span>
        </div>
        {errorAudio && (
          <p className="aviso error" role="alert">
            {errorAudio}
          </p>
        )}
        <ul className="glosario">
          {palabras.map((p) => (
            <li key={`${p.unidad}-${p.pt}`}>
              <button
                className={sonando === p.pt ? "palabra sonando" : "palabra"}
                onClick={() => oir(p)}
                aria-label={`Escuchar ${p.pt}${p.es ? `, ${p.es}` : ""}`}
              >
                <span className="palavra" lang="pt-BR">{p.pt}</span>
                <span className="significado">{p.es || "sin significado aún"}</span>
                {p.nota && (
                  <span className={/falso cognato/i.test(p.nota) ? "nota-palabra falso" : "nota-palabra"}>{p.nota}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
