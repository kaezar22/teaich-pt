import { useEffect, useState } from "react";
import { profe } from "../../api.js";

const TIPOS = {
  completar: "Completa el espacio con la palabra correcta",
  ordenar: "Ordena las palabras para formar una frase",
  pt_es: "Traduce al español",
  es_pt: "Traduce al portugués",
  responder: "Responde la pregunta en portugués",
  lectura: "Lee el texto y responde en portugués",
  redaccion: "Escribe un texto corto usando estas palabras",
};
const ESCRITURA = { es_pt: "Traducir al portugués", ordenar: "Ordenar palabras", completar: "Completar espacios", responder: "Responder preguntas", redaccion: "Redacción con palabras dadas" };
const DIFICULTADES = ["Fácil", "Intermedio", "Difícil"];

function Segmentado({ opciones, valor, cambiar, etiqueta }) {
  return (
    <div className="segmentado" role="radiogroup" aria-label={etiqueta}>
      {opciones.map(([texto, v]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === valor} className={v === valor ? "activo" : ""} onClick={() => cambiar(v)}>
          {texto}
        </button>
      ))}
    </div>
  );
}

// Elegir espacio, nivel y unidades (compartido por los tres tipos de material)
export function useEleccion(cursos) {
  const [espacio, setEspacio] = useState("");
  const [nivel, setNivel] = useState("");
  const [unidades, setUnidades] = useState([]);
  const esp = cursos?.espacios.find((e) => e.id === espacio) || cursos?.espacios[0];
  const niv = esp?.niveles.find((n) => n.nivel === nivel) || esp?.niveles[0];
  const validas = unidades.filter((u) => niv?.unidades.some((x) => x.unidad === u));
  const elegidas = validas.length ? validas : niv ? [niv.unidades.at(-1).unidad] : [];
  return {
    esp, niv, elegidas,
    setEspacio: (v) => { setEspacio(v); setNivel(""); setUnidades([]); },
    setNivel: (v) => { setNivel(v); setUnidades([]); },
    alternar: (u) => {
      const n = elegidas.includes(u) ? elegidas.filter((x) => x !== u) : [...elegidas, u].sort((a, b) => a - b);
      if (n.length) setUnidades(n);
    },
  };
}

function Eleccion({ cursos, el }) {
  if (!el.esp) return <p className="aviso">No hay espacios con vocabulario todavía.</p>;
  return (
    <fieldset className="eleccion-profe">
      <legend>Material para</legend>
      <label>
        Espacio
        <select value={el.esp.id} onChange={(e) => el.setEspacio(e.target.value)}>
          {cursos.espacios.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
      </label>
      {el.esp.niveles.length > 1 && (
        <Segmentado etiqueta="Nivel" opciones={el.esp.niveles.map((n) => [n.nivel, n.nivel])} valor={el.niv.nivel} cambiar={el.setNivel} />
      )}
      <div className="unidades">
        {el.niv?.unidades.map((u) => (
          <button
            key={u.unidad}
            type="button"
            aria-pressed={el.elegidas.includes(u.unidad)}
            className={el.elegidas.includes(u.unidad) ? "unidad activa" : "unidad"}
            onClick={() => el.alternar(u.unidad)}
          >
            Vocabulario {u.unidad}
            <small>{u.palabras.length} palabras</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Vista({ preguntas }) {
  return (
    <ol className="vista-preguntas">
      {preguntas.map((p, i) => (
        <li key={i}>
          <strong>{TIPOS[p.tipo]}</strong>
          {p.tipo === "lectura" ? (
            <>
              <p lang="pt-BR">{p.texto}</p>
              <ul>
                {p.preguntas.map((s, j) => (
                  <li key={j} lang="pt-BR">
                    {s.enunciado} → <b>{s.respuesta}</b>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p lang="pt-BR">
              {p.tipo === "ordenar" || p.tipo === "redaccion" ? p.palabras.join(" / ") : p.enunciado} → <b>{p.respuesta}</b>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function Material({ token, salir }) {
  const [cursos, setCursos] = useState(null);
  const [tipo, setTipo] = useState("examen");
  const [titulo, setTitulo] = useState({ examen: "Examen de práctica", escritura: "Ejercicios de escritura", listening: "Ejercicio de listening" });
  const [dificultad, setDificultad] = useState("Intermedio");
  const [cantidad, setCantidad] = useState({ examen: 10, escritura: 8, listening: 5 });
  const [tiposEscritura, setTiposEscritura] = useState(["es_pt", "ordenar", "redaccion"]);
  const [dictado, setDictado] = useState(true);
  const [lento, setLento] = useState(true);
  const [voz, setVoz] = useState("femenina");
  const [material, setMaterial] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const el = useEleccion(cursos);

  useEffect(() => {
    profe.cursos(token).then(setCursos).catch((e) => (e.codigo === 401 ? salir() : setError(e.message)));
  }, [token, salir]);

  const descripcion = el.niv ? `${el.niv.nivel}, vocabulario ${el.elegidas.join(", ")}` : "";
  const base = el.esp ? { espacio: el.esp.id, nivel: el.niv.nivel, unidades: el.elegidas } : null;

  async function correr(mensaje, accion) {
    setOcupado(mensaje);
    setError("");
    try {
      await accion();
    } catch (e) {
      if (e.codigo === 401) salir();
      else setError(e.message);
    } finally {
      setOcupado("");
    }
  }

  const generar = () =>
    correr("Generando…", async () => {
      const datos = { ...base, dificultad, cantidad: cantidad[tipo], ...(tipo === "escritura" ? { tipos: tiposEscritura } : {}) };
      const r = await profe.preguntas(token, datos);
      setMaterial({ tipo, titulo: titulo[tipo], descripcion, preguntas: r.preguntas });
    });

  const bajarWord = (clave) =>
    correr("Preparando el Word…", () =>
      profe.docx(
        token,
        { titulo: material.titulo, descripcion: material.descripcion, preguntas: material.preguntas, clave },
        `${material.tipo}${clave ? "_clave" : ""}.docx`,
      ),
    );

  const bajarListening = () =>
    correr("Generando frases y audios… (puede tardar unos segundos)", () =>
      profe.listening(token, { ...base, titulo: titulo.listening, descripcion, cantidad: cantidad.listening, dictado, lento, voz }, "listening.zip"),
    );

  const cantidades = { examen: [5, 8, 10, 12, 15], escritura: [4, 6, 8, 10, 12], listening: [3, 5, 8, 10] }[tipo];

  return (
    <>
      <div className="filtros">
        <h1>Material para clase</h1>
      </div>
      <p className="aviso">Genera material con su clave de respuestas para imprimir o editar en Word.</p>
      {!cursos && !error && <p className="aviso">Cargando…</p>}
      {cursos && <Eleccion cursos={cursos} el={el} />}

      {cursos && el.esp && (
        <section className="material">
          <Segmentado
            etiqueta="Tipo de material"
            opciones={[["Examen", "examen"], ["Escritura", "escritura"], ["Listening", "listening"]]}
            valor={tipo}
            cambiar={(t) => {
              setTipo(t);
              setError("");
            }}
          />
          <div className="config-material">
            <label className="ancho">
              Título
              <input value={titulo[tipo]} onChange={(e) => setTitulo({ ...titulo, [tipo]: e.target.value })} maxLength={120} />
            </label>
            {tipo === "escritura" && (
              <fieldset className="casillas">
                <legend>Tipos de ejercicio</legend>
                {Object.entries(ESCRITURA).map(([t, nombre]) => (
                  <label key={t}>
                    <input
                      type="checkbox"
                      checked={tiposEscritura.includes(t)}
                      onChange={() => setTiposEscritura(tiposEscritura.includes(t) ? tiposEscritura.filter((x) => x !== t) : [...tiposEscritura, t])}
                    />
                    {nombre}
                  </label>
                ))}
              </fieldset>
            )}
            {tipo !== "listening" && (
              <Segmentado etiqueta="Dificultad" opciones={DIFICULTADES.map((d) => [d, d])} valor={dificultad} cambiar={setDificultad} />
            )}
            {tipo === "listening" && (
              <>
                <Segmentado etiqueta="Ejercicio" opciones={[["Dictado", true], ["Comprensión", false]]} valor={dictado} cambiar={setDictado} />
                <Segmentado etiqueta="Velocidad" opciones={[["Lenta", true], ["Normal", false]]} valor={lento} cambiar={setLento} />
                <Segmentado etiqueta="Voz" opciones={[["Voz femenina", "femenina"], ["Voz masculina", "masculina"]]} valor={voz} cambiar={setVoz} />
              </>
            )}
            <div className="cantidades" role="radiogroup" aria-label="Cantidad">
              <span>{tipo === "listening" ? "Audios" : tipo === "examen" ? "Preguntas" : "Ejercicios"}</span>
              {cantidades.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={n === cantidad[tipo]} className={n === cantidad[tipo] ? "cantidad activa" : "cantidad"} onClick={() => setCantidad({ ...cantidad, [tipo]: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {tipo === "listening" ? (
            <button className="boton" onClick={bajarListening} disabled={Boolean(ocupado)}>
              {ocupado || "Generar y descargar (audios MP3, hoja y clave)"}
            </button>
          ) : (
            <button className="boton" onClick={generar} disabled={Boolean(ocupado) || (tipo === "escritura" && !tiposEscritura.length)}>
              {ocupado === "Generando…" ? ocupado : `Generar ${tipo === "examen" ? "examen" : "ejercicios"}`}
            </button>
          )}
          {error && (
            <p className="aviso error" role="alert">
              {error}
            </p>
          )}

          {material && material.tipo === tipo && tipo !== "listening" && (
            <div className="resultado-material">
              <div className="acciones">
                <button className="boton" onClick={() => bajarWord(false)} disabled={Boolean(ocupado)}>
                  Descargar hoja del estudiante
                </button>
                <button className="boton secundario" onClick={() => bajarWord(true)} disabled={Boolean(ocupado)}>
                  Descargar clave de respuestas
                </button>
              </div>
              <p className="aviso">
                {material.preguntas.length} preguntas para {material.descripcion}. Las respuestas solo se ven aquí y en la clave.
              </p>
              <Vista preguntas={material.preguntas} />
            </div>
          )}
        </section>
      )}
    </>
  );
}
