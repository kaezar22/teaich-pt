import { useCallback, useEffect, useState } from "react";
import { profe } from "../../api.js";

function Pin({ pin }) {
  const [ver, setVer] = useState(false);
  return (
    <span className="pin-celda">
      <code>{ver ? pin || "(sin PIN)" : "••••••"}</code>
      <button className="boton-texto" onClick={() => setVer(!ver)}>
        {ver ? "Ocultar" : "Ver"}
      </button>
    </span>
  );
}

export default function Estudiantes({ token, salir }) {
  const [datos, setDatos] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [error, setError] = useState("");
  const [nombre, setNombre] = useState("");
  const [espacio, setEspacio] = useState("");
  const [notas, setNotas] = useState("");
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState(null);
  const [cambiando, setCambiando] = useState(null);
  const [copiado, setCopiado] = useState(false);

  const manejar = useCallback(
    (e) => {
      if (e.codigo === 401) salir();
      else setError(e.message);
    },
    [salir],
  );

  const cargar = useCallback(async () => {
    try {
      const [lista, resumen] = await Promise.all([profe.estudiantes(token), profe.resumen(token)]);
      setDatos(lista);
      setAvisos(resumen.avisos);
      setEspacio((e) => e || lista.espacios[0]?.id || "");
    } catch (e) {
      manejar(e);
    }
  }, [token, manejar]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function crear(e) {
    e.preventDefault();
    setCreando(true);
    setError("");
    setCopiado(false);
    try {
      const est = await profe.crearEstudiante(token, { nombre, espacio, notas });
      setNuevo(est);
      setNombre("");
      setNotas("");
      await cargar();
    } catch (err) {
      manejar(err);
    } finally {
      setCreando(false);
    }
  }

  async function activar(est) {
    setCambiando(est.id);
    setError("");
    try {
      await profe.activar(token, est.id, !est.activo);
      await cargar();
    } catch (err) {
      manejar(err);
    } finally {
      setCambiando(null);
    }
  }

  async function releer() {
    setError("");
    try {
      await profe.recargar(token);
      await cargar();
    } catch (err) {
      manejar(err);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(`Tu PIN para practicar portugués: ${nuevo.pin}`);
      setCopiado(true);
    } catch {
      /* el navegador no permitió copiar */
    }
  }

  return (
    <>
      <div className="filtros">
        <h1>Estudiantes</h1>
        <button className="boton secundario" onClick={releer}>
          Releer la hoja de Google
        </button>
      </div>
      <p className="aviso">Los estudiantes se guardan en la pestaña “estudiantes” de tu hoja. También puedes editarlos allí.</p>

      {error && (
        <p className="aviso error" role="alert">
          {error}
        </p>
      )}

      {avisos.length > 0 && (
        <section className="avisos-hoja" aria-labelledby="titulo-avisos">
          <h2 id="titulo-avisos">Revisa tu hoja</h2>
          <ul>
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <form className="nuevo-estudiante" onSubmit={crear}>
        <h2>Agregar estudiante</h2>
        <div className="campos">
          <label>
            Nombre
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} required />
          </label>
          <label>
            Espacio
            <select value={espacio} onChange={(e) => setEspacio(e.target.value)}>
              {datos?.espacios.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="ancho">
            Notas (opcional)
            <input value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={200} />
          </label>
        </div>
        <button className="boton" disabled={creando || !nombre.trim() || !espacio}>
          {creando ? "Agregando…" : "Agregar estudiante"}
        </button>
        {nuevo && (
          <div className="pin-nuevo" role="status">
            <p>
              Agregaste a <strong>{nuevo.nombre}</strong>. Su PIN es
            </p>
            <code>{nuevo.pin}</code>
            <button type="button" className="boton secundario" onClick={copiar}>
              {copiado ? "Copiado" : "Copiar mensaje con el PIN"}
            </button>
          </div>
        )}
      </form>

      {datos?.espacios.map((esp) => {
        const lista = datos.estudiantes.filter((s) => s.espacio === esp.id);
        return (
          <section key={esp.id} className="espacio-dash" aria-labelledby={`lista-${esp.id}`}>
            <div className="titulo-seccion">
              <h2 id={`lista-${esp.id}`}>{esp.nombre}</h2>
              <span>
                {lista.filter((s) => s.activo).length} {lista.filter((s) => s.activo).length === 1 ? "activo" : "activos"}
              </span>
            </div>
            {lista.length === 0 ? (
              <p className="aviso">Sin estudiantes todavía.</p>
            ) : (
              <div className="tabla-scroll">
                <table className="tabla-dash">
                  <thead>
                    <tr>
                      <th scope="col">Estudiante</th>
                      <th scope="col">Id</th>
                      <th scope="col">PIN</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((s) => (
                      <tr key={s.id} className={s.activo ? "" : "inactivo"}>
                        <th scope="row">{s.nombre}</th>
                        <td>
                          <code>{s.id}</code>
                        </td>
                        <td>
                          <Pin pin={s.pin} />
                        </td>
                        <td className="celda-estado">
                          <span>{s.activo ? "Activo" : "Inactivo"}</span>
                          <button className="boton-texto" disabled={cambiando === s.id} onClick={() => activar(s)}>
                            {cambiando === s.id ? "Guardando…" : s.activo ? "Desactivar" : "Activar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
