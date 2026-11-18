import { useCallback, useEffect, useRef, useState } from "react";
import { api, reproducir, urlAudio } from "../api.js";
import TecladoTildes from "../components/TecladoTildes.jsx";
import { usePractica } from "../lib/usePractica.js";

const MODOS = {
  es_pt: { titulo: "Español → Portugués", ayuda: "Escribe la frase en portugués de Brasil (con tildes y ç).", pista: "Escreva em português…" },
  pt_es: { titulo: "Portugués → Español", ayuda: "Traduce la frase al español.", pista: "Escribe la traducción…" },
  escucha: { titulo: "Listening", ayuda: "Escucha la frase las veces que necesites.", pista: "" },
};

function Resultado({ res }) {
  if (res.sin_respuesta) return <p className="veredicto neutro">No pasa nada. Mira la respuesta, escúchala y sigue con la próxima.</p>;
  if (res.puntaje >= 1) return <p className="veredicto bien">Correcto. {res.feedback}</p>;
  if (res.puntaje > 0) return <p className="veredicto casi">Casi. {res.feedback}</p>;
  return <p className="veredicto mal">{res.feedback || "No es correcto."}</p>;
}

export default function Practica({ modo, nivel, unidades, token }) {
  usePractica(token, modo);
  const conf = MODOS[modo];
  const [cola, setCola] = useState([]);
  const [i, setI] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [res, setRes] = useState(null);
  const [revisando, setRevisando] = useState(false);
  const [marcador, setMarcador] = useState({ ok: 0, total: 0 });
  const vistas = useRef([]);
  const campo = useRef(null);

  // Opciones de listening
  const [dictado, setDictado] = useState(true);
  const [lento, setLento] = useState(true);
  const [voz, setVoz] = useState("femenina");

  const pedirFrases = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await api.frases(token, { nivel, unidades, cantidad: 6, evitar: vistas.current.slice(-30) });
      setCola(r.frases);
      setI(0);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [token, nivel, unidades]);

  useEffect(() => {
    pedirFrases();
  }, [pedirFrases]);

  const frase = cola[i];
  const enPortugues = modo === "es_pt" || (modo === "escucha" && dictado);
  const opcionesAudio = { lento, voz };

  const oir = useCallback(
    (f = frase, opciones = { lento, voz }) => {
      if (f) reproducir(token, f.pt, opciones).catch(() => setError("No se pudo reproducir el audio."));
    },
    [frase, token, lento, voz],
  );

  // En listening, la frase suena sola al aparecer
  useEffect(() => {
    if (modo === "escucha" && frase && !res) oir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, frase]);

  useEffect(() => {
    if (!res) campo.current?.focus();
  }, [frase, res]);

  // Precarga el audio de la siguiente frase
  useEffect(() => {
    const sig = cola[i + 1];
    if (modo === "escucha" && sig) urlAudio(token, sig.pt, opcionesAudio).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cola, i, modo, token, lento, voz]);

  async function comprobar(noSe = false) {
    const texto = noSe ? "" : respuesta.trim();
    if (!noSe && !texto) return;
    const datos =
      modo === "es_pt"
        ? { modo, enunciado: frase.es, referencia: frase.pt }
        : modo === "pt_es"
          ? { modo, enunciado: frase.pt, referencia: frase.es }
          : dictado
            ? { modo: "dictado", enunciado: "(audio)", referencia: frase.pt }
            : { modo: "comprension", enunciado: frase.pt, referencia: frase.es };
    setRevisando(true);
    setError("");
    try {
      const r = await api.calificar(token, { ...datos, respuesta: texto });
      setRes({ ...r, respuesta: texto });
      setMarcador((m) => ({ ok: m.ok + r.puntaje, total: m.total + 1 }));
      vistas.current.push(frase.pt);
      if (modo !== "escucha") oir(frase, { lento: false, voz: "femenina" });
    } catch (e) {
      setError(e.message);
    } finally {
      setRevisando(false);
    }
  }

  function siguiente() {
    setRes(null);
    setRespuesta("");
    if (i + 1 >= cola.length) pedirFrases();
    else setI(i + 1);
  }

  return (
    <section className="practica" aria-labelledby="titulo-practica">
      <div className="practica-cabeza">
        <div>
          <h1 id="titulo-practica">{conf.titulo}</h1>
          <p className="aviso">{conf.ayuda}</p>
        </div>
        {marcador.total > 0 && (
          <p className="marcador-mini">
            <strong>
              {marcador.ok % 1 ? marcador.ok.toFixed(1) : marcador.ok} de {marcador.total}
            </strong>{" "}
            aciertos
          </p>
        )}
      </div>

      {modo === "escucha" && (
        <div className="opciones-escucha">
          <div className="segmentado" role="radiogroup" aria-label="Ejercicio">
            {[["Dictado", true], ["Comprensión", false]].map(([t, v]) => (
              <button key={t} role="radio" aria-checked={dictado === v} className={dictado === v ? "activo" : ""} onClick={() => setDictado(v)} disabled={Boolean(res)}>
                {t}
              </button>
            ))}
          </div>
          <div className="segmentado" role="radiogroup" aria-label="Velocidad">
            {[["Lenta", true], ["Normal", false]].map(([t, v]) => (
              <button key={t} role="radio" aria-checked={lento === v} className={lento === v ? "activo" : ""} onClick={() => setLento(v)}>
                {t}
              </button>
            ))}
          </div>
          <div className="segmentado" role="radiogroup" aria-label="Voz">
            {[["Voz femenina", "femenina"], ["Voz masculina", "masculina"]].map(([t, v]) => (
              <button key={v} role="radio" aria-checked={voz === v} className={voz === v ? "activo" : ""} onClick={() => setVoz(v)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="aviso error" role="alert">
          {error}{" "}
          {!frase && (
            <button className="boton-texto" onClick={pedirFrases}>
              Reintentar
            </button>
          )}
        </div>
      )}
      {cargando && <p className="aviso">Preparando frases nuevas…</p>}

      {frase && !cargando && (
        <>
          <div className="tarjeta-frase">
            {modo === "es_pt" && <p className="frase-es">{frase.es}</p>}
            {modo === "pt_es" && (
              <p className="frase-pt" lang="pt-BR">
                {frase.pt}
              </p>
            )}
            {modo === "escucha" && (
              <button className="boton-audio" onClick={() => oir()}>
                <span aria-hidden="true">🔊</span>
                {dictado ? "Escucha y escribe lo que oyes" : "Escucha: ¿qué significa?"}
              </button>
            )}
          </div>

          {!res ? (
            <form
              className="respuesta"
              onSubmit={(e) => {
                e.preventDefault();
                comprobar();
              }}
            >
              <label htmlFor="respuesta" className="sr">
                Tu respuesta
              </label>
              <input
                id="respuesta"
                ref={campo}
                value={respuesta}
                onChange={(e) => setRespuesta(e.target.value)}
                placeholder={conf.pista || (dictado ? "Escreva o que você ouviu…" : "Escribe qué significa…")}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                lang={enPortugues ? "pt-BR" : "es"}
                disabled={revisando}
              />
              {enPortugues && <TecladoTildes entrada={campo} setTexto={setRespuesta} />}
              <div className="acciones">
                <button className="boton" disabled={revisando || !respuesta.trim()}>
                  {revisando ? "Revisando…" : "Comprobar"}
                </button>
                <button type="button" className="boton secundario" onClick={() => comprobar(true)} disabled={revisando}>
                  No sé
                </button>
              </div>
            </form>
          ) : (
            <div className="revision" aria-live="polite">
              {res.respuesta && (
                <p>
                  <strong>Tu respuesta:</strong> {res.respuesta}
                </p>
              )}
              <Resultado res={res} />
              <div className="solucion">
                <p className="frase-pt" lang="pt-BR">
                  {frase.pt}
                </p>
                <p>{frase.es}</p>
                <button className="boton-texto" onClick={() => oir(frase, { lento: false, voz })}>
                  Escuchar la frase
                </button>
              </div>
              <button className="boton" onClick={siguiente} autoFocus>
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
