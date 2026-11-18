import { useEffect, useMemo, useState } from "react";
import { profe } from "../../api.js";

const NUEVO = "__nuevo__";

// Una palabra o expresión por línea o separadas por comas ("café da manhã" queda entera)
function separar(texto) {
  const vistas = [];
  for (const crudo of texto.split(/[\n,;]+/)) {
    const p = crudo.replace(/\s+/g, " ").trim();
    if (p && !vistas.some((v) => v.toLowerCase() === p.toLowerCase())) vistas.push(p);
  }
  return vistas;
}

const clave = (p) => p.toLowerCase();

// ¿Aparece la palabra (o una forma suya: falar ~ falo) en alguna frase? Aproximado, solo para avisar.
function usada(palabra, lineas) {
  const texto = lineas.join(" ").toLowerCase();
  const p = palabra.toLowerCase();
  if (texto.includes(p)) return true;
  const raiz = p.replace(/(ar|er|ir|or|as|os|a|o|e|s)$/, "");
  return raiz.length >= 3 && texto.split(/[^\p{L}-]+/u).some((w) => w.startsWith(raiz));
}

export default function VocabularioProfe({ token, salir }) {
  const [cursos, setCursos] = useState(null);
  const [espacio, setEspacio] = useState("");
  const [nuevoEspacio, setNuevoEspacio] = useState({ id: "", nombre: "" });
  const [nivel, setNivel] = useState("");
  const [nivelNuevo, setNivelNuevo] = useState("");
  const [unidad, setUnidad] = useState(NUEVO);
  const [texto, setTexto] = useState("");
  const [detalle, setDetalle] = useState({}); // palabra en minúsculas -> {es, nota, origen}
  const [frases, setFrases] = useState("");
  const [revision, setRevision] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = () =>
    profe.cursos(token).then(setCursos).catch((e) => (e.codigo === 401 ? salir() : setError(e.message)));
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const esNuevoEspacio = espacio === NUEVO;
  const esp = !esNuevoEspacio ? cursos?.espacios.find((e) => e.id === espacio) || cursos?.espacios[0] : null;
  const espacioId = esNuevoEspacio ? nuevoEspacio.id : esp?.id;
  // Solo se editan las unidades escritas en este espacio (no las que vienen de un espacio incluido)
  const niveles = useMemo(
    () => (esp?.niveles || []).map((n) => ({ ...n, unidades: n.unidades.filter((u) => u.propia) })).filter((n) => n.unidades.length),
    [esp],
  );
  const nivelElegido = nivel === NUEVO || !niveles.length ? NUEVO : niveles.find((n) => n.nivel === nivel)?.nivel || niveles.at(-1).nivel;
  const nombreNivel = nivelElegido === NUEVO ? nivelNuevo.trim() : nivelElegido;
  const unidadesNivel = niveles.find((n) => n.nivel === nivelElegido)?.unidades || [];
  const siguiente = (unidadesNivel.at(-1)?.unidad || 0) + 1;
  const numeroUnidad = unidad === NUEVO ? siguiente : Number(unidad);

  // Al elegir una unidad existente, se cargan sus palabras y frases
  useEffect(() => {
    setRevision(null);
    const u = unidad === NUEVO ? null : unidadesNivel.find((x) => x.unidad === Number(unidad));
    setTexto(u ? u.palabras.map((p) => p.pt).join("\n") : "");
    setDetalle(u ? Object.fromEntries(u.palabras.map((p) => [clave(p.pt), { es: p.es, nota: p.nota, origen: "hoja" }])) : {});
    setFrases(u ? u.frases.join("\n") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espacioId, nivelElegido, unidad, cursos]);

  const palabras = separar(texto);
  const lineas = frases.split("\n").map((f) => f.trim()).filter(Boolean);
  const incompletas = palabras.filter((p) => !detalle[clave(p)]?.es);
  const sinUsar = lineas.length ? palabras.filter((p) => !usada(p, lineas)) : [];
  const idValido = /^[a-z0-9][a-z0-9-]{0,39}$/.test(espacioId || "");
  const listo = palabras.length && lineas.length && nombreNivel && idValido;

  async function correr(mensaje, accion) {
    setOcupado(mensaje);
    setError("");
    setAviso("");
    try {
      await accion();
    } catch (e) {
      if (e.codigo === 401) salir();
      else setError(e.message);
    } finally {
      setOcupado("");
    }
  }

  const completar = (sugerir) =>
    correr(sugerir ? "Escribiendo frases…" : "Buscando significados…", async () => {
      const r = await profe.completar(token, {
        espacio: espacioId || "nuevo", nivel: nombreNivel || "Nivel", unidad: numeroUnidad,
        palabras: texto, frases: lineas, sugerir_frases: sugerir,
      });
      // Lo que el profesor ya corrigió a mano no se pisa
      const nuevo = { ...detalle };
      palabras.forEach((w, k) => {
        const p = r.palabras[k];
        if (p && !nuevo[clave(w)]?.es) nuevo[clave(w)] = { es: p.es, nota: p.nota, origen: p.origen, sugerida: p.pt !== w ? p.pt : "" };
      });
      setDetalle(nuevo);
      if (sugerir && r.frases_sugeridas.length) setFrases([...lineas, ...r.frases_sugeridas].join("\n"));
      setRevision(r.fuera_de_vocabulario);
    });

  const guardar = () =>
    correr("Guardando en la hoja…", async () => {
      await profe.guardarVocabulario(token, {
        espacio: espacioId, nombre_espacio: esNuevoEspacio ? nuevoEspacio.nombre : "",
        nivel: nombreNivel, unidad: numeroUnidad,
        palabras: palabras.map((w) => ({ pt: w, es: detalle[clave(w)]?.es || "", nota: detalle[clave(w)]?.nota || "" })),
        frases: lineas,
      });
      setAviso(`Guardado: ${nombreNivel}, unidade ${numeroUnidad} (${palabras.length} palabras y ${lineas.length} frases). Los estudiantes lo ven de inmediato.`);
      if (esNuevoEspacio) setEspacio(espacioId);
      setNivel(nombreNivel);
      setUnidad(String(numeroUnidad));
      await cargar();
    });

  const editar = (w, campo, valor) => setDetalle({ ...detalle, [clave(w)]: { ...detalle[clave(w)], [campo]: valor, origen: "tú" } });

  if (!cursos) return error ? <p className="aviso error">{error}</p> : <p className="aviso">Cargando…</p>;

  return (
    <>
      <div className="filtros">
        <h1>Vocabulario</h1>
      </div>
      <p className="aviso">Agrega un vocabulario nuevo o corrige uno existente. Se guarda directo en tu hoja de Google.</p>

      <fieldset className="eleccion-profe">
        <legend>Unidad</legend>
        <div className="campos">
          <label>
            Espacio
            <select value={esNuevoEspacio ? NUEVO : esp?.id} onChange={(e) => { setEspacio(e.target.value); setNivel(""); setUnidad(NUEVO); setAviso(""); }}>
              {cursos.espacios.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
              <option value={NUEVO}>Nuevo espacio…</option>
            </select>
          </label>
          <label>
            Nivel
            <select value={nivelElegido} onChange={(e) => { setNivel(e.target.value); setUnidad(NUEVO); setAviso(""); }}>
              {niveles.map((n) => (
                <option key={n.nivel} value={n.nivel}>
                  {n.nivel}
                </option>
              ))}
              <option value={NUEVO}>Nuevo nivel…</option>
            </select>
          </label>
          {esNuevoEspacio && (
            <>
              <label>
                Nombre del espacio
                <input value={nuevoEspacio.nombre} placeholder="Português para viagem" onChange={(e) => setNuevoEspacio({ ...nuevoEspacio, nombre: e.target.value })} />
              </label>
              <label>
                Nombre corto (para las pestañas)
                <input value={nuevoEspacio.id} placeholder="viagem" onChange={(e) => setNuevoEspacio({ ...nuevoEspacio, id: e.target.value.toLowerCase() })} aria-invalid={Boolean(nuevoEspacio.id) && !idValido} />
                <small>Minúsculas, números y guiones. Crea las pestañas {nuevoEspacio.id || "nombre"}_vocabulario y {nuevoEspacio.id || "nombre"}_frases.</small>
              </label>
            </>
          )}
          {nivelElegido === NUEVO && (
            <label>
              Nombre del nivel
              <input value={nivelNuevo} placeholder="Português 3" onChange={(e) => setNivelNuevo(e.target.value)} />
            </label>
          )}
          <label>
            Unidade
            <select value={unidad} onChange={(e) => { setUnidad(e.target.value); setAviso(""); }}>
              <option value={NUEVO}>Nueva: unidade {siguiente}</option>
              {unidadesNivel.map((u) => (
                <option key={u.unidad} value={u.unidad}>
                  Editar unidade {u.unidad}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <section className="editor-vocab">
        <label className="bloque">
          <span>Palabras o expresiones en portugués (una por línea o separadas por comas)</span>
          <textarea rows={5} lang="pt-BR" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={"tempo\nfrio, calor\nestá chovendo"} />
        </label>
        <div className="acciones">
          <button className="boton secundario" onClick={() => completar(false)} disabled={Boolean(ocupado) || !palabras.length}>
            Completar significado y notas
          </button>
          <span className="aviso">
            {palabras.length} palabras{incompletas.length ? `, ${incompletas.length} sin significado` : ""}
          </span>
        </div>

        {palabras.length > 0 && (
          <div className="tabla-scroll">
            <table className="tabla-dash tabla-vocab">
              <thead>
                <tr>
                  <th scope="col">Palavra</th>
                  <th scope="col">Significado</th>
                  <th scope="col">Nota (género, verbo, falso cognato…)</th>
                  <th scope="col">Origen</th>
                </tr>
              </thead>
              <tbody>
                {palabras.map((w) => (
                  <tr key={clave(w)}>
                    <th scope="row" lang="pt-BR">
                      {w}
                      {detalle[clave(w)]?.sugerida && <small className="sugerida">¿Quisiste decir «{detalle[clave(w)].sugerida}»?</small>}
                    </th>
                    <td>
                      <input aria-label={`Significado de ${w}`} value={detalle[clave(w)]?.es || ""} onChange={(e) => editar(w, "es", e.target.value)} />
                    </td>
                    <td>
                      <input aria-label={`Nota de ${w}`} value={detalle[clave(w)]?.nota || ""} onChange={(e) => editar(w, "nota", e.target.value)} />
                    </td>
                    <td className="origen">{{ hoja: "De tu hoja", ia: "IA, revísalo", tú: "Editado" }[detalle[clave(w)]?.origen] || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <label className="bloque">
          <span>Frases de entrenamiento (una por línea)</span>
          <textarea rows={8} lang="pt-BR" value={frases} onChange={(e) => setFrases(e.target.value)} placeholder={"Hoje está muito frio.\nAmanhã vai fazer calor?"} />
        </label>
        <div className="acciones">
          <button className="boton secundario" onClick={() => completar(true)} disabled={Boolean(ocupado) || !palabras.length || (esNuevoEspacio && !idValido)}>
            Sugerir frases con IA
          </button>
          <span className="aviso">{lineas.length} frases</span>
        </div>

        {(sinUsar.length > 0 || revision?.length > 0) && (
          <div className="avisos-hoja">
            {sinUsar.length > 0 && <p>Palabras que aún no aparecen en ninguna frase: <span lang="pt-BR">{sinUsar.join(", ")}</span></p>}
            {revision?.length > 0 && (
              <p>
                Estas palabras aparecen en las frases pero parecen nuevas (no están en ningún vocabulario hasta esta unidad): <span lang="pt-BR">{revision.join(", ")}</span>. Es una revisión aproximada: puedes dejarlas o agregarlas a las palabras.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="aviso error" role="alert">
            {error}
          </p>
        )}
        {aviso && (
          <p className="veredicto bien" role="status">
            {aviso}
          </p>
        )}
        <div className="acciones">
          <button className="boton" onClick={guardar} disabled={Boolean(ocupado) || !listo}>
            {ocupado || "Guardar en la hoja"}
          </button>
          {!listo && <span className="aviso">Escribe las palabras, al menos una frase{nivelElegido === NUEVO ? " y el nombre del nivel" : ""}{esNuevoEspacio ? " y un nombre corto válido" : ""}.</span>}
        </div>
      </section>
    </>
  );
}
