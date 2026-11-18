import { Fragment, useEffect, useRef, useState } from "react";
import { chatear } from "../api.js";
import { usePractica } from "../lib/usePractica.js";

const SUGERENCIAS = [
  "¿Cuándo se usa «no», «na», «do» y «da»?",
  "¿Cuáles falsos amigos debo conocer?",
  "¿Cuál es la diferencia entre ser y estar en portugués?",
  "Ponme un ejercicio con mi vocabulario",
];

// Markdown mínimo: **negrita**, `código`, listas con "-" o "1." y párrafos
function enLinea(texto) {
  return texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((t, i) => {
    if (t.startsWith("**") && t.endsWith("**")) return <strong key={i}>{t.slice(2, -2)}</strong>;
    if (t.startsWith("`") && t.endsWith("`")) return <code key={i}>{t.slice(1, -1)}</code>;
    return <Fragment key={i}>{t}</Fragment>;
  });
}

function Markdown({ texto }) {
  const bloques = [];
  let lista = null;
  for (const linea of texto.split("\n")) {
    const item = linea.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      const ordenada = /^\s*\d/.test(linea);
      if (!lista || lista.ordenada !== ordenada) {
        lista = { ordenada, items: [] };
        bloques.push(lista);
      }
      lista.items.push(item[1]);
      continue;
    }
    lista = null;
    const t = linea.replace(/^#{1,6}\s+/, "");
    if (t.trim()) bloques.push({ parrafo: t, titulo: t !== linea });
  }
  return bloques.map((b, i) => {
    if (b.items) {
      const Lista = b.ordenada ? "ol" : "ul";
      return (
        <Lista key={i}>
          {b.items.map((it, k) => (
            <li key={k}>{enLinea(it)}</li>
          ))}
        </Lista>
      );
    }
    return b.titulo ? <h3 key={i}>{enLinea(b.parrafo)}</h3> : <p key={i}>{enLinea(b.parrafo)}</p>;
  });
}

export default function Chat({ nivel, unidades, token }) {
  usePractica(token, "chat");
  const [historial, setHistorial] = useState([]);
  const [texto, setTexto] = useState("");
  const [escribiendo, setEscribiendo] = useState(false);
  const [error, setError] = useState("");
  const final = useRef(null);
  const campo = useRef(null);

  useEffect(() => {
    final.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [historial]);

  async function enviar(pregunta) {
    pregunta = pregunta.trim();
    if (!pregunta || escribiendo) return;
    const nuevo = [...historial, { role: "user", content: pregunta }];
    setHistorial([...nuevo, { role: "assistant", content: "" }]);
    setTexto("");
    setError("");
    setEscribiendo(true);
    try {
      const respuesta = await chatear(token, { nivel, unidades, historial: nuevo.slice(-16) }, (parcial) =>
        setHistorial([...nuevo, { role: "assistant", content: parcial }]),
      );
      setHistorial([...nuevo, { role: "assistant", content: respuesta }]);
    } catch (e) {
      setHistorial(historial);
      setTexto(pregunta);
      setError(e.message);
    } finally {
      setEscribiendo(false);
      campo.current?.focus();
    }
  }

  return (
    <section className="chat" aria-labelledby="titulo-chat">
      <h1 id="titulo-chat">Gramática con el tutor</h1>
      <p className="aviso">Pregunta lo que quieras sobre gramática o cómo decir algo con tu vocabulario.</p>

      {!historial.length && (
        <div className="sugerencias">
          {SUGERENCIAS.map((s) => (
            <button key={s} className="sugerencia" onClick={() => enviar(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <ol className="mensajes" aria-live="polite">
        {historial.map((m, i) => (
          <li key={i} className={m.role === "user" ? "mensaje estudiante" : "mensaje tutor"}>
            <span className="quien">{m.role === "user" ? "Tú" : "Tutor"}</span>
            <div className="cuerpo">
              {m.role === "user" ? <p>{m.content}</p> : m.content ? <Markdown texto={m.content} /> : <p className="aviso">Escribiendo…</p>}
            </div>
          </li>
        ))}
      </ol>
      <div ref={final} />

      {error && (
        <p className="aviso error" role="alert">
          {error}
        </p>
      )}

      <form
        className="caja-chat"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(texto);
        }}
      >
        <label htmlFor="pregunta" className="sr">
          Tu pregunta
        </label>
        <textarea
          id="pregunta"
          ref={campo}
          rows={2}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar(texto);
            }
          }}
          placeholder="Escribe tu pregunta…"
          maxLength={2000}
        />
        <div className="acciones">
          <button className="boton" disabled={escribiendo || !texto.trim()}>
            Enviar
          </button>
          {historial.length > 0 && (
            <button type="button" className="boton secundario" disabled={escribiendo} onClick={() => setHistorial([])}>
              Nueva conversación
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
