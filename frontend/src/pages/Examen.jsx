import { useState } from "react";
import { api } from "../api.js";
import { usePractica } from "../lib/usePractica.js";

const DIFICULTADES = {
  Fácil: "Reconocer: completar, ordenar y traducir al español.",
  Intermedio: "Además: traducir al portugués y responder preguntas.",
  Difícil: "Además: comprensión de lectura y redacción.",
};
const CANTIDADES = [5, 8, 10, 12];
const TIPOS = {
  completar: "Completa el espacio con la palabra correcta",
  ordenar: "Ordena las palabras para formar una frase",
  pt_es: "Traduce al español",
  es_pt: "Traduce al portugués",
  responder: "Responde la pregunta en portugués",
  lectura: "Lee el texto y responde en portugués",
  redaccion: "Escribe un texto corto usando estas palabras",
};

// Convierte el examen en ítems calificables (la lectura tiene varias preguntas)
function itemsDe(preguntas, respuestas) {
  const items = [];
  preguntas.forEach((p, i) => {
    if (p.tipo === "lectura") {
      p.preguntas.forEach((s, j) =>
        items.push({
          id: `${i}.${j}`, tipo: p.tipo, enunciado: `Texto: ${p.texto}\nPregunta: ${s.enunciado}`,
          referencia: s.respuesta, respuesta: respuestas[`${i}.${j}`] || "",
        }),
      );
      return;
    }
    const enunciado =
      p.tipo === "ordenar" ? p.palabras.join(" / ")
        : p.tipo === "redaccion" ? `Escribir unas ${p.longitud} palabras usando: ${p.palabras.join(", ")}`
          : p.enunciado;
    items.push({ id: String(i), tipo: p.tipo, enunciado, referencia: p.respuesta, respuesta: respuestas[String(i)] || "" });
  });
  return items;
}

function Enunciado({ n, p }) {
  return (
    <>
      <h2 className="enunciado-titulo">
        {n}. {TIPOS[p.tipo]}
      </h2>
      {(p.tipo === "ordenar" || p.tipo === "redaccion") && (
        <div className="fichas" lang="pt-BR">
          {p.palabras.map((w, k) => (
            <span key={k} className="ficha-palabra">
              {w}
            </span>
          ))}
        </div>
      )}
      {p.tipo === "redaccion" && <p className="aviso">Escribe un texto de unas {p.longitud} palabras.</p>}
      {p.tipo === "lectura" && (
        <p className="frase-pt lectura" lang="pt-BR">
          {p.texto}
        </p>
      )}
      {p.tipo === "es_pt" && <p className="frase-es">{p.enunciado}</p>}
      {["completar", "pt_es", "responder"].includes(p.tipo) && (
        <p className="frase-pt" lang="pt-BR">
          {p.enunciado}
        </p>
      )}
    </>
  );
}

function Icono({ puntaje }) {
  if (puntaje >= 1) return <span className="nota bien">Correcta</span>;
  if (puntaje > 0) return <span className="nota casi">Parcial</span>;
  return <span className="nota mal">Incorrecta</span>;
}

export default function Examen({ nivel, unidades, token }) {
  usePractica(token, "examen");
  const [dificultad, setDificultad] = useState("Fácil");
  const [cantidad, setCantidad] = useState(8);
  const [examen, setExamen] = useState(null);
  const [respuestas, setRespuestas] = useState({});
  const [resultados, setResultados] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");

  async function generar() {
    setOcupado("Preparando tu examen…");
    setError("");
    try {
      const r = await api.examen(token, { nivel, unidades, dificultad, cantidad });
      setExamen({ dificultad, preguntas: r.preguntas });
      setRespuestas({});
      setResultados(null);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado("");
    }
  }

  async function entregar() {
    setOcupado("Calificando…");
    setError("");
    try {
      const r = await api.calificarExamen(token, itemsDe(examen.preguntas, respuestas));
      setResultados(r.resultados);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado("");
    }
  }

  const campo = (clave, largo = false, etiqueta = "Tu respuesta") => {
    const props = {
      id: `r-${clave}`,
      value: respuestas[clave] || "",
      onChange: (e) => setRespuestas({ ...respuestas, [clave]: e.target.value }),
      placeholder: "Tu respuesta…",
      autoComplete: "off",
    };
    return (
      <>
        <label htmlFor={props.id} className={etiqueta === "Tu respuesta" ? "sr" : "sub-pregunta"} lang="pt-BR">
          {etiqueta}
        </label>
        {largo ? <textarea rows={4} {...props} /> : <input {...props} />}
      </>
    );
  };

  // --- configuración ---
  if (!examen) {
    return (
      <section className="examen" aria-labelledby="titulo-examen">
        <h1 id="titulo-examen">Examen de prueba</h1>
        <p className="aviso">Las respuestas y la calificación aparecen solo cuando entregas el examen.</p>
        <div className="config-examen">
          <div className="segmentado" role="radiogroup" aria-label="Dificultad">
            {Object.keys(DIFICULTADES).map((d) => (
              <button key={d} role="radio" aria-checked={d === dificultad} className={d === dificultad ? "activo" : ""} onClick={() => setDificultad(d)}>
                {d}
              </button>
            ))}
          </div>
          <p className="aviso">{DIFICULTADES[dificultad]}</p>
          <div className="cantidades" role="radiogroup" aria-label="Número de preguntas">
            <span>Preguntas</span>
            {CANTIDADES.map((n) => (
              <button key={n} role="radio" aria-checked={n === cantidad} className={n === cantidad ? "cantidad activa" : "cantidad"} onClick={() => setCantidad(n)}>
                {n}
              </button>
            ))}
          </div>
          <button className="boton" onClick={generar} disabled={Boolean(ocupado)}>
            {ocupado || "Generar examen"}
          </button>
        </div>
        {error && (
          <p className="aviso error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  const items = itemsDe(examen.preguntas, respuestas);

  // --- resultados ---
  if (resultados) {
    const puntos = items.reduce((s, it) => s + (resultados[it.id]?.puntaje || 0), 0);
    const pct = Math.round((100 * puntos) / items.length);
    return (
      <section className="examen" aria-labelledby="titulo-examen">
        <h1 id="titulo-examen">Resultado del examen ({examen.dificultad.toLowerCase()})</h1>
        <p className="marcador">
          <strong>{pct}%</strong>
          <span>
            {puntos % 1 ? puntos.toFixed(1) : puntos} de {items.length} puntos
          </span>
        </p>
        <p className="aviso">
          {pct >= 85 ? "¡Excelente! Arrasou! 🎉" : pct >= 60 ? "¡Vas bien! Repasa los errores." : "Sigue practicando: revisa cada explicación."}
        </p>
        <ol className="preguntas">
          {examen.preguntas.map((p, i) => {
            const subs = p.tipo === "lectura"
              ? p.preguntas.map((s, j) => ({ clave: `${i}.${j}`, sub: s.enunciado, correcta: s.respuesta }))
              : [{ clave: String(i), sub: null, correcta: p.respuesta }];
            return (
              <li key={i} className="pregunta-examen">
                <Enunciado n={i + 1} p={p} />
                {subs.map(({ clave, sub, correcta }) => {
                  const r = resultados[clave] || { puntaje: 0, feedback: "" };
                  return (
                    <div key={clave} className="calificacion">
                      {sub && (
                        <p className="sub-pregunta" lang="pt-BR">
                          {sub}
                        </p>
                      )}
                      <p>
                        <Icono puntaje={r.puntaje} /> <strong>Tu respuesta:</strong> {(respuestas[clave] || "").trim() || "(en blanco)"}
                      </p>
                      {(r.puntaje < 1 || p.tipo === "redaccion") && (
                        <p>
                          <strong>{p.tipo === "redaccion" ? "Texto modelo" : "Respuesta correcta"}:</strong>{" "}
                          <span lang="pt-BR">{correcta}</span>
                        </p>
                      )}
                      {r.feedback && !r.sin_respuesta && <p className="aviso">{r.feedback}</p>}
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ol>
        <button className="boton" onClick={() => setExamen(null)}>
          Hacer otro examen
        </button>
      </section>
    );
  }

  // --- resolviendo ---
  return (
    <section className="examen" aria-labelledby="titulo-examen">
      <h1 id="titulo-examen">Examen de prueba ({examen.dificultad.toLowerCase()})</h1>
      <p className="aviso">Si no sabes una respuesta, déjala en blanco. Las tildes cuentan, pero si solo fallas en ellas igual se te da el punto.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          entregar();
        }}
      >
        <ol className="preguntas">
          {examen.preguntas.map((p, i) => (
            <li key={i} className="pregunta-examen">
              <Enunciado n={i + 1} p={p} />
              {p.tipo === "lectura"
                ? p.preguntas.map((s, j) => <div key={j}>{campo(`${i}.${j}`, false, s.enunciado)}</div>)
                : campo(String(i), p.tipo === "redaccion")}
            </li>
          ))}
        </ol>
        {error && (
          <p className="aviso error" role="alert">
            {error}
          </p>
        )}
        <div className="acciones">
          <button className="boton" disabled={Boolean(ocupado)}>
            {ocupado || "Entregar examen"}
          </button>
          <button type="button" className="boton secundario" disabled={Boolean(ocupado)} onClick={() => setExamen(null)}>
            Cancelar examen
          </button>
        </div>
      </form>
    </section>
  );
}
