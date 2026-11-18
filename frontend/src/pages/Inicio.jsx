import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Chat from "./Chat.jsx";
import Examen from "./Examen.jsx";
import Juego from "./Juego.jsx";
import Practica from "./Practica.jsx";
import Vocabulario from "./Vocabulario.jsx";

// Actividades del menú
const ACTIVIDADES = [
  { id: "vocab", signo: "Aa", titulo: "Mi vocabulario", desc: "Palabras con significado, notas y pronunciación, y juegos con cronómetro." },
  { id: "es_pt", signo: "ES›PT", titulo: "Español → Portugués", desc: "Lee una frase en español y escríbela en portugués." },
  { id: "pt_es", signo: "PT›ES", titulo: "Portugués → Español", desc: "Lee una frase en portugués y tradúcela al español." },
  { id: "escucha", signo: "♪", titulo: "Listening", desc: "Escucha una frase y escribe lo que oyes o qué significa." },
  { id: "chat", signo: "Oi?", titulo: "Gramática con la tutora", desc: "Pregunta dudas de gramática, falsos amigos o cómo se dice algo." },
  { id: "examen", signo: "A+", titulo: "Examen de prueba", desc: "Elige la dificultad y mide cuánto sabes." },
];

const CLAVE_ELECCION = "teaich-pt.eleccion";

function leerEleccion() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_ELECCION)) || {};
  } catch {
    return {};
  }
}

function guardarEleccion(e) {
  try {
    localStorage.setItem(CLAVE_ELECCION, JSON.stringify(e));
  } catch {
    /* no pasa nada */
  }
}

export default function Inicio({ sesion, salir }) {
  const { estudiante, token } = sesion;
  const [curso, setCurso] = useState(null);
  const [error, setError] = useState("");
  const [nivel, setNivel] = useState(null);
  const [unidades, setUnidades] = useState([]);
  const [pantalla, setPantalla] = useState({ id: "menu" });

  useEffect(() => {
    let vivo = true;
    api
      .curso(token)
      .then((c) => {
        if (!vivo) return;
        setCurso(c);
        const previa = leerEleccion();
        const n = c.niveles.find((x) => x.nivel === previa.nivel) || c.niveles[0];
        if (!n) return;
        setNivel(n.nivel);
        const validas = (previa.unidades || []).filter((u) => n.unidades.some((x) => x.unidad === u));
        setUnidades(validas.length ? validas : [n.unidades.at(-1).unidad]);
      })
      .catch((e) => {
        if (e.codigo === 401) salir();
        else if (vivo) setError(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [token, salir]);

  const nivelActual = curso?.niveles.find((n) => n.nivel === nivel);

  const palabras = useMemo(() => {
    if (!nivelActual) return [];
    return nivelActual.unidades
      .filter((u) => unidades.includes(u.unidad))
      .flatMap((u) => u.palabras.map((p) => ({ ...p, unidad: u.unidad })));
  }, [nivelActual, unidades]);

  function elegirNivel(n) {
    const ultima = curso.niveles.find((x) => x.nivel === n).unidades.at(-1).unidad;
    setNivel(n);
    setUnidades([ultima]);
    guardarEleccion({ nivel: n, unidades: [ultima] });
  }

  function alternarUnidad(u) {
    const nuevas = unidades.includes(u) ? unidades.filter((x) => x !== u) : [...unidades, u].sort((a, b) => a - b);
    if (!nuevas.length) return; // siempre al menos una
    setUnidades(nuevas);
    guardarEleccion({ nivel, unidades: nuevas });
  }

  return (
    <div className="inicio">
      <header className="barra">
        <div className="marca">
          <span className="sello-mini" aria-hidden="true">Oi</span>
          <div>
            <strong>{estudiante.nombre}</strong>
            <span>{estudiante.espacio_nombre}</span>
          </div>
        </div>
        <button className="boton-texto" onClick={salir}>
          Salir
        </button>
      </header>

      <main className="contenido">
        {error && (
          <p className="aviso error" role="alert">
            {error}
          </p>
        )}
        {!curso && !error && <p className="aviso">Cargando tu curso…</p>}
        {curso && !curso.niveles.length && (
          <p className="aviso">Tu espacio todavía no tiene vocabulario. Pídele a tu profesor que lo cargue.</p>
        )}

        {nivelActual && pantalla.id === "menu" && (
          <>
            <section className="eleccion" aria-label="Qué quieres repasar">
              <h1>¿Qué quieres repasar?</h1>
              {curso.niveles.length > 1 && (
                <div className="niveles" role="radiogroup" aria-label="Nivel">
                  {curso.niveles.map((n) => (
                    <button
                      key={n.nivel}
                      role="radio"
                      aria-checked={n.nivel === nivel}
                      className={n.nivel === nivel ? "nivel activo" : "nivel"}
                      onClick={() => elegirNivel(n.nivel)}
                    >
                      {n.nivel}
                    </button>
                  ))}
                </div>
              )}
              <div className="unidades" aria-label="Unidades">
                {nivelActual.unidades.map((u) => (
                  <button
                    key={u.unidad}
                    aria-pressed={unidades.includes(u.unidad)}
                    className={unidades.includes(u.unidad) ? "unidad activa" : "unidad"}
                    onClick={() => alternarUnidad(u.unidad)}
                  >
                    Unidade {u.unidad}
                    <small>{u.palabras.length} palabras</small>
                  </button>
                ))}
              </div>
            </section>

            <section aria-labelledby="titulo-actividades">
              <div className="titulo-seccion">
                <h2 id="titulo-actividades">¿Qué quieres practicar hoy?</h2>
                <span>{palabras.length} palabras elegidas</span>
              </div>
              <ul className="actividades">
                {ACTIVIDADES.map((a) => (
                  <li key={a.id}>
                    <button className="actividad" disabled={a.pronto} onClick={() => setPantalla({ id: a.id })}>
                      <span className="signo" aria-hidden="true">
                        {a.signo}
                      </span>
                      <span className="actividad-texto">
                        <strong>{a.titulo}</strong>
                        <span>{a.pronto ? "Disponible pronto" : a.desc}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {nivelActual && pantalla.id !== "menu" && (
          <nav className="miga" aria-label="Ubicación">
            <button
              className="boton-texto"
              onClick={() => setPantalla(pantalla.id === "juego" ? { id: "vocab" } : { id: "menu" })}
            >
              ← {pantalla.id === "juego" ? "Mi vocabulario" : "Menú"}
            </button>
            <span>
              {nivel}, unidade {unidades.join(", ")}
            </span>
          </nav>
        )}

        {nivelActual && pantalla.id === "vocab" && (
          <Vocabulario
            palabras={palabras}
            token={token}
            jugar={(tipo, jugables, cantidad) => setPantalla({ id: "juego", tipo, jugables, cantidad })}
          />
        )}

        {nivelActual && ["es_pt", "pt_es", "escucha"].includes(pantalla.id) && (
          <Practica key={pantalla.id} modo={pantalla.id} nivel={nivel} unidades={unidades} token={token} />
        )}
        {nivelActual && pantalla.id === "chat" && <Chat nivel={nivel} unidades={unidades} token={token} />}
        {nivelActual && pantalla.id === "examen" && <Examen nivel={nivel} unidades={unidades} token={token} />}

        {nivelActual && pantalla.id === "juego" && (
          <Juego
            tipo={pantalla.tipo}
            palabras={pantalla.jugables}
            cantidad={pantalla.cantidad}
            nivel={nivel}
            unidades={unidades}
            token={token}
            volver={() => setPantalla({ id: "vocab" })}
          />
        )}
      </main>
    </div>
  );
}
