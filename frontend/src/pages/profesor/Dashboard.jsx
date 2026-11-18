import { useEffect, useState } from "react";
import { profe } from "../../api.js";
import { ACTIVIDADES, diaCorto, duracion, haceCuanto } from "../../lib/formato.js";

const PERIODOS = [7, 30, 90];

// Columnas de minutos por día (una sola serie: no necesita leyenda)
function PorDia({ dias, nombre }) {
  const max = Math.max(60, ...dias.map((d) => d.segundos));
  const [activo, setActivo] = useState(null);
  const d = activo != null ? dias[activo] : null;
  return (
    <figure className="por-dia">
      <figcaption>
        Práctica por día
        <span className="por-dia-detalle" aria-live="polite">
          {d ? `${diaCorto(d.fecha)}: ${duracion(d.segundos)}` : ""}
        </span>
      </figcaption>
      <div className="columnas" role="list" aria-label={`Práctica por día en ${nombre}`} onMouseLeave={() => setActivo(null)}>
        {dias.map((dia, i) => (
          <div
            key={dia.fecha}
            role="listitem"
            className={i === activo ? "columna activa" : "columna"}
            tabIndex={0}
            aria-label={`${diaCorto(dia.fecha)}: ${duracion(dia.segundos)}`}
            onMouseEnter={() => setActivo(i)}
            onFocus={() => setActivo(i)}
            onBlur={() => setActivo(null)}
          >
            <span style={{ height: `${dia.segundos ? Math.max(4, (100 * dia.segundos) / max) : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="columnas-eje" aria-hidden="true">
        <span>{diaCorto(dias[0].fecha)}</span>
        <span>{diaCorto(dias.at(-1).fecha)}</span>
      </div>
    </figure>
  );
}

function Espacio({ esp }) {
  const max = Math.max(1, ...esp.estudiantes.map((e) => e.segundos));
  const total = esp.estudiantes.filter((e) => e.activo || e.segundos).length;
  return (
    <section className="espacio-dash" aria-labelledby={`esp-${esp.id}`}>
      <div className="titulo-seccion">
        <h2 id={`esp-${esp.id}`}>{esp.nombre}</h2>
        <span>
          {esp.con_practica} de {total} {total === 1 ? "estudiante practicó" : "estudiantes practicaron"}
        </span>
      </div>
      <div className="resumen-espacio">
        <p className="cifra">
          <strong>{duracion(esp.segundos)}</strong>
          <span>de práctica en total</span>
        </p>
        <PorDia dias={esp.por_dia} nombre={esp.nombre} />
      </div>

      {esp.estudiantes.length === 0 ? (
        <p className="aviso">Este espacio aún no tiene estudiantes. Agrégalos en la pestaña Estudiantes.</p>
      ) : (
        <div className="tabla-scroll">
          <table className="tabla-dash">
            <thead>
              <tr>
                <th scope="col">Estudiante</th>
                <th scope="col">Tiempo</th>
                <th scope="col">Días</th>
                <th scope="col">Juegos</th>
                <th scope="col">Última práctica</th>
                <th scope="col">En qué practicó</th>
              </tr>
            </thead>
            <tbody>
              {esp.estudiantes.map((e) => {
                const acts = Object.entries(e.por_actividad).sort((a, b) => b[1] - a[1]);
                const j = e.juegos;
                return (
                  <tr key={e.id} className={e.activo ? "" : "inactivo"}>
                    <th scope="row">
                      {e.nombre}
                      {!e.activo && <small>inactivo</small>}
                    </th>
                    <td className="celda-tiempo">
                      <span className="barra-tiempo" aria-hidden="true">
                        <span style={{ width: `${(100 * e.segundos) / max}%` }} />
                      </span>
                      {duracion(e.segundos)}
                    </td>
                    <td>{e.dias_activos}</td>
                    <td>{j.rondas ? `${j.rondas} ${j.rondas === 1 ? "ronda" : "rondas"}, ${Math.round((100 * j.aciertos) / j.preguntas)}% aciertos` : "—"}</td>
                    <td>{haceCuanto(e.ultima)}</td>
                    <td className="celda-actividades">
                      {acts.length
                        ? acts.slice(0, 3).map(([a, s]) => `${ACTIVIDADES[a] || a} ${duracion(s)}`).join(", ")
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Dashboard({ token, salir }) {
  const [dias, setDias] = useState(7);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError("");
    profe
      .dashboard(token, dias)
      .then((d) => vivo && setDatos(d))
      .catch((e) => {
        if (e.codigo === 401) salir();
        else if (vivo) setError(e.message);
      })
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [token, dias, vuelta, salir]);

  return (
    <>
      <div className="filtros">
        <h1>Tiempo de práctica</h1>
        <div className="segmentado" role="radiogroup" aria-label="Periodo">
          {PERIODOS.map((p) => (
            <button key={p} role="radio" aria-checked={p === dias} className={p === dias ? "activo" : ""} onClick={() => setDias(p)}>
              {p} días
            </button>
          ))}
        </div>
        <button className="boton secundario" onClick={() => setVuelta(vuelta + 1)} disabled={cargando}>
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>
      <p className="aviso">Solo cuenta el tiempo con la app abierta y en uso; las pausas de más de 2 minutos no suman.</p>
      {error && (
        <p className="aviso error" role="alert">
          {error}
        </p>
      )}
      {!datos && !error && <p className="aviso">Cargando…</p>}
      {datos?.espacios.map((esp) => (
        <Espacio key={esp.id} esp={esp} />
      ))}
    </>
  );
}
