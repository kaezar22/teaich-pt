import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, reproducir, urlAudio } from "../api.js";
import TecladoTildes from "../components/TecladoTildes.jsx";
import { JUEGOS, barajar, comparar, crearPreguntas } from "../lib/juegos.js";
import { usePractica } from "../lib/usePractica.js";

const PAUSA_RESPUESTA = 700; // ms para ver si acertó antes de pasar a la siguiente

function formatoTiempo(seg) {
  const s = Math.max(0, Math.ceil(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Cronómetro de la ronda
// ---------------------------------------------------------------------------
function useCronometro(limite, activo, alTerminar) {
  const [restante, setRestante] = useState(limite);
  const inicio = useRef(performance.now());
  const fin = useRef(alTerminar);
  fin.current = alTerminar;

  useEffect(() => {
    if (!activo) return;
    const id = setInterval(() => {
      const r = limite - (performance.now() - inicio.current) / 1000;
      setRestante(r);
      if (r <= 0) fin.current();
    }, 100);
    return () => clearInterval(id);
  }, [activo, limite]);

  const usado = () => Math.min(limite, (performance.now() - inicio.current) / 1000);
  return { restante, usado };
}

function Reloj({ restante, limite }) {
  const fraccion = Math.max(0, restante / limite);
  const urgente = restante <= Math.min(10, limite * 0.25);
  return (
    <div className={urgente ? "reloj urgente" : "reloj"} role="timer" aria-label={`Quedan ${formatoTiempo(restante)}`}>
      <span className="reloj-texto">{formatoTiempo(restante)}</span>
      <span className="reloj-barra" aria-hidden="true">
        <span style={{ transform: `scaleX(${fraccion})` }} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opción múltiple: palavra → significado, audio → palavra
// ---------------------------------------------------------------------------
function OpcionMultiple({ tipo, palabras, cantidad, token, alTerminar }) {
  const preguntas = useMemo(() => crearPreguntas(palabras, cantidad, tipo), [palabras, cantidad, tipo]);
  const limite = preguntas.length * JUEGOS[tipo].segundos;
  const [i, setI] = useState(0);
  const [elegida, setElegida] = useState(null);
  const respuestas = useRef([]);
  const terminado = useRef(false);

  const terminar = useCallback(() => {
    if (terminado.current) return;
    terminado.current = true;
    alTerminar(
      preguntas.map((p, k) => ({ palabra: p.correcta, elegida: respuestas.current[k] ?? null })),
      usado(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preguntas, alTerminar]);
  const { restante, usado } = useCronometro(limite, true, terminar);

  const pregunta = preguntas[i];
  const conAudio = tipo === "audio_pt";

  const oir = useCallback(() => {
    reproducir(token, pregunta.correcta.pt).catch(() => {});
  }, [token, pregunta]);

  useEffect(() => {
    if (!conAudio) return;
    oir();
    const sig = preguntas[i + 1];
    if (sig) urlAudio(token, sig.correcta.pt).catch(() => {}); // precarga
  }, [conAudio, oir, preguntas, i, token]);

  const elegir = useCallback(
    (op) => {
      if (elegida || terminado.current) return;
      setElegida(op);
      respuestas.current[i] = op;
      if (!conAudio) reproducir(token, pregunta.correcta.pt).catch(() => {}); // oye la palabra al responder
      setTimeout(() => {
        if (i + 1 >= preguntas.length) terminar();
        else {
          setI(i + 1);
          setElegida(null);
        }
      }, PAUSA_RESPUESTA + (conAudio ? 0 : 300));
    },
    [elegida, i, preguntas.length, terminar, conAudio, token, pregunta],
  );

  // Atajos de teclado: 1-4 para responder, espacio para repetir el audio
  useEffect(() => {
    const tecla = (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= pregunta.opciones.length) elegir(pregunta.opciones[n - 1]);
      if (conAudio && e.key === " ") {
        e.preventDefault();
        oir();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [pregunta, elegir, conAudio, oir]);

  const muestraPt = conAudio; // las opciones son palabras en portugués
  return (
    <>
      <div className="juego-cabeza">
        <span className="progreso">
          {i + 1} de {preguntas.length}
        </span>
        <Reloj restante={restante} limite={limite} />
      </div>

      <div className="pregunta">
        {tipo === "pt_es" && (
          <p className="palavra grande" lang="pt-BR">
            {pregunta.correcta.pt}
          </p>
        )}
        {conAudio && (
          <button className="boton-audio" onClick={oir} aria-label="Escuchar otra vez">
            <span aria-hidden="true">🔊</span>
            Escuchar otra vez
          </button>
        )}
        {elegida && conAudio && <p className="pista">{pregunta.correcta.es}</p>}
        {elegida && !conAudio && pregunta.correcta.nota && <p className="pista">{pregunta.correcta.nota}</p>}
      </div>

      <ol className={muestraPt ? "opciones opciones-pt" : "opciones"}>
        {pregunta.opciones.map((op, k) => {
          let estado = "";
          if (elegida) {
            if (op === pregunta.correcta) estado = "bien";
            else if (op === elegida) estado = "mal";
          }
          return (
            <li key={op.pt}>
              <button className={`opcion ${estado}`} onClick={() => elegir(op)} disabled={Boolean(elegida)}>
                <kbd aria-hidden="true">{k + 1}</kbd>
                {muestraPt ? (
                  <span className="opcion-pt" lang="pt-BR">
                    {op.pt}
                  </span>
                ) : (
                  <span>{op.es}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ---------------------------------------------------------------------------
// Escribir: significado → palavra (con teclado de tildes)
// ---------------------------------------------------------------------------
function Escribir({ palabras, cantidad, token, alTerminar }) {
  const preguntas = useMemo(() => barajar(palabras).slice(0, cantidad), [palabras, cantidad]);
  const limite = preguntas.length * JUEGOS.es_pt.segundos;
  const [i, setI] = useState(0);
  const [texto, setTexto] = useState("");
  const [veredicto, setVeredicto] = useState(null); // exacta | tildes | distinta
  const respuestas = useRef([]);
  const terminado = useRef(false);
  const entrada = useRef(null);

  const terminar = useCallback(() => {
    if (terminado.current) return;
    terminado.current = true;
    alTerminar(
      preguntas.map((p, k) => {
        const r = respuestas.current[k];
        return { palabra: p, elegida: r && r.veredicto !== "distinta" ? p : null, escrito: r?.texto, tildes: r?.veredicto === "tildes" };
      }),
      usado(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preguntas, alTerminar]);
  const { restante, usado } = useCronometro(limite, true, terminar);
  const palabra = preguntas[i];

  function siguiente() {
    if (i + 1 >= preguntas.length) terminar();
    else {
      setI(i + 1);
      setTexto("");
      setVeredicto(null);
      requestAnimationFrame(() => entrada.current?.focus());
    }
  }

  function enviar(e) {
    e.preventDefault();
    if (veredicto) return siguiente();
    if (!texto.trim()) return;
    const v = comparar(texto, palabra.pt);
    respuestas.current[i] = { texto, veredicto: v };
    setVeredicto(v);
    reproducir(token, palabra.pt).catch(() => {});
  }

  function noSe() {
    if (veredicto) return;
    respuestas.current[i] = { texto: "", veredicto: "distinta" };
    setVeredicto("distinta");
    reproducir(token, palabra.pt).catch(() => {});
  }

  const mensajes = {
    exacta: "¡Exato! ✓",
    tildes: "¡Casi perfecto! Revisa las tildes:",
    distinta: "Se escribe:",
  };

  return (
    <>
      <div className="juego-cabeza">
        <span className="progreso">
          {i + 1} de {preguntas.length}
        </span>
        <Reloj restante={restante} limite={limite} />
      </div>
      <div className="pregunta">
        <p className="pregunta-es">{palabra.es}</p>
        {palabra.nota && <p className="nota-palabra">{palabra.nota}</p>}
      </div>
      <form className="escribir" onSubmit={enviar}>
        <input
          ref={entrada}
          className={`entrada-pt ${veredicto ? `v-${veredicto}` : ""}`}
          value={texto}
          onChange={(e) => !veredicto && setTexto(e.target.value)}
          placeholder="Escribe en portugués…"
          lang="pt-BR"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={`Escribe en portugués: ${palabra.es}`}
          readOnly={Boolean(veredicto)}
        />
        {!veredicto && <TecladoTildes entrada={entrada} setTexto={setTexto} />}
        {veredicto && (
          <p className={`veredicto v-${veredicto}`} aria-live="polite">
            {mensajes[veredicto]} {veredicto !== "exacta" && <strong lang="pt-BR">{palabra.pt}</strong>}
          </p>
        )}
        <div className="acciones">
          <button className="boton" type="submit">
            {veredicto ? (i + 1 >= preguntas.length ? "Ver resultado" : "Siguiente") : "Comprobar"}
          </button>
          {!veredicto && (
            <button className="boton secundario" type="button" onClick={noSe}>
              No sé
            </button>
          )}
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Emparejar
// ---------------------------------------------------------------------------
function Parejas({ palabras, cantidad, alTerminar }) {
  const pares = useMemo(() => barajar(palabras).slice(0, cantidad), [palabras, cantidad]);
  const izquierda = useMemo(() => barajar(pares), [pares]);
  const derecha = useMemo(() => barajar(pares), [pares]);
  const limite = pares.length * JUEGOS.parejas.segundos;

  const [hechos, setHechos] = useState(() => new Set());
  const [sel, setSel] = useState({ pt: null, es: null });
  const [fallo, setFallo] = useState(null);
  const conError = useRef(new Set());
  const terminado = useRef(false);

  const terminar = useCallback(
    (hechosFinal) => {
      if (terminado.current) return;
      terminado.current = true;
      alTerminar(
        pares.map((p) => ({
          palabra: p,
          elegida: hechosFinal.has(p.pt) && !conError.current.has(p.pt) ? p : null,
        })),
        usado(),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pares, alTerminar],
  );
  const hechosRef = useRef(hechos);
  hechosRef.current = hechos;
  const { restante, usado } = useCronometro(limite, true, () => terminar(hechosRef.current));

  function tocar(lado, p) {
    if (hechos.has(p.pt) || fallo) return;
    const nueva = { ...sel, [lado]: sel[lado] === p ? null : p };
    if (!(nueva.pt && nueva.es)) {
      setSel(nueva);
      return;
    }
    if (nueva.pt === nueva.es) {
      const h = new Set(hechos).add(p.pt);
      setHechos(h);
      setSel({ pt: null, es: null });
      if (h.size === pares.length) setTimeout(() => terminar(h), 300);
    } else {
      conError.current.add(nueva.pt.pt);
      setSel(nueva);
      setFallo(nueva);
      setTimeout(() => {
        setFallo(null);
        setSel({ pt: null, es: null });
      }, 600);
    }
  }

  const clase = (lado, p) => {
    if (hechos.has(p.pt)) return "ficha hecha";
    if (fallo && fallo[lado] === p) return "ficha mal";
    if (sel[lado] === p) return "ficha elegida";
    return "ficha";
  };

  return (
    <>
      <div className="juego-cabeza">
        <span className="progreso">
          {hechos.size} de {pares.length} parejas
        </span>
        <Reloj restante={restante} limite={limite} />
      </div>
      <p className="ayuda-juego">Toca una palabra y luego su significado.</p>
      <div className="parejas">
        <ul aria-label="Palabras en portugués">
          {izquierda.map((p) => (
            <li key={p.pt}>
              <button
                className={clase("pt", p)}
                onClick={() => tocar("pt", p)}
                disabled={hechos.has(p.pt)}
                aria-pressed={sel.pt === p}
                lang="pt-BR"
              >
                <span className="opcion-pt">{p.pt}</span>
              </button>
            </li>
          ))}
        </ul>
        <ul aria-label="Significados">
          {derecha.map((p) => (
            <li key={p.pt}>
              <button
                className={clase("es", p)}
                onClick={() => tocar("es", p)}
                disabled={hechos.has(p.pt)}
                aria-pressed={sel.es === p}
              >
                {p.es}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ronda completa: juego + resultado
// ---------------------------------------------------------------------------
export default function Juego({ tipo, palabras, cantidad, nivel, unidades, token, volver }) {
  usePractica(token, "juego");
  const [ronda, setRonda] = useState(0);
  const [resultado, setResultado] = useState(null);
  const [guardado, setGuardado] = useState("");

  const alTerminar = useCallback(
    (respuestas, segundos) => {
      const aciertos = respuestas.filter((r) => r.elegida === r.palabra).length;
      setResultado({ respuestas, segundos, aciertos });
      setGuardado("guardando");
      api
        .resultado(token, { juego: tipo, nivel, unidades, preguntas: respuestas.length, aciertos, segundos })
        .then(() => setGuardado("ok"))
        .catch(() => setGuardado("error"));
    },
    [token, tipo, nivel, unidades],
  );

  function otraVez() {
    setResultado(null);
    setGuardado("");
    setRonda(ronda + 1);
  }

  const juego = JUEGOS[tipo];

  if (resultado) {
    const { respuestas, segundos, aciertos } = resultado;
    const errores = respuestas.filter((r) => r.elegida !== r.palabra);
    const tildes = respuestas.filter((r) => r.tildes);
    const pct = Math.round((100 * aciertos) / respuestas.length);
    return (
      <section className="resultado" aria-live="polite">
        <h1>{juego.nombre}</h1>
        <p className="marcador">
          <strong>
            {aciertos} de {respuestas.length}
          </strong>
          <span>en {formatoTiempo(segundos)}</span>
        </p>
        <p className="aviso">
          {pct === 100 ? "¡Perfeito! Parabéns! 🎉" : pct >= 70 ? "¡Muy bien! Repasa las que fallaste." : "Sigue practicando: repasa estas palabras."}
          {guardado === "error" && " (No se pudo guardar el resultado.)"}
        </p>
        {errores.length > 0 && (
          <>
            <h2>Para repasar</h2>
            <ul className="repaso">
              {errores.map(({ palabra, escrito }) => (
                <li key={palabra.pt}>
                  <span className="opcion-pt" lang="pt-BR">
                    {palabra.pt}
                  </span>
                  <span className="significado">{palabra.es}</span>
                  {escrito && <span className="escrito">Escribiste: {escrito}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {tildes.length > 0 && (
          <>
            <h2>Bien, pero ojo con las tildes</h2>
            <ul className="repaso">
              {tildes.map(({ palabra, escrito }) => (
                <li key={palabra.pt}>
                  <span className="opcion-pt" lang="pt-BR">
                    {palabra.pt}
                  </span>
                  <span className="significado">{palabra.es}</span>
                  <span className="escrito">Escribiste: {escrito}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="acciones">
          <button className="boton" onClick={otraVez} autoFocus>
            Jugar otra vez
          </button>
          <button className="boton secundario" onClick={volver}>
            Volver a Mi vocabulario
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="juego" aria-label={juego.nombre}>
      {tipo === "parejas" ? (
        <Parejas key={ronda} palabras={palabras} cantidad={cantidad} alTerminar={alTerminar} />
      ) : tipo === "es_pt" ? (
        <Escribir key={ronda} palabras={palabras} cantidad={cantidad} token={token} alTerminar={alTerminar} />
      ) : (
        <OpcionMultiple key={ronda} tipo={tipo} palabras={palabras} cantidad={cantidad} token={token} alTerminar={alTerminar} />
      )}
      <button className="boton-texto salir-juego" onClick={volver}>
        Salir del juego
      </button>
    </section>
  );
}
