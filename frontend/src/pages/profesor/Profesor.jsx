import { useCallback, useState } from "react";
import { guardarSesionProfe, leerSesionProfe, profe } from "../../api.js";
import Dashboard from "./Dashboard.jsx";
import Estudiantes from "./Estudiantes.jsx";
import Material from "./Material.jsx";
import VocabularioProfe from "./VocabularioProfe.jsx";

const SECCIONES = [
  { id: "dashboard", titulo: "Dashboard" },
  { id: "estudiantes", titulo: "Estudiantes" },
  { id: "material", titulo: "Material para clase" },
  { id: "vocabulario", titulo: "Vocabulario" },
];

function EntrarProfe({ alEntrar }) {
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setEnviando(true);
    setError("");
    try {
      alEntrar((await profe.entrar(clave)).token);
    } catch (err) {
      setError(err.codigo === 401 ? "Clave incorrecta." : err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="entrar">
      <div className="sello" aria-hidden="true">
        <span>Prof</span>
      </div>
      <h1>Zona del profesor</h1>
      <form className="clave-profe" onSubmit={enviar}>
        <label htmlFor="clave">Clave de profesor</label>
        <input id="clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoFocus autoComplete="current-password" />
        <button className="boton" disabled={enviando || !clave}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
        <p className={error ? "aviso error" : "aviso"} role={error ? "alert" : undefined}>
          {error}
        </p>
      </form>
      <a className="enlace-profe" href="/">
        Ir a la app de estudiantes
      </a>
    </main>
  );
}

export default function Profesor() {
  const [token, setToken] = useState(leerSesionProfe);
  const [seccion, setSeccion] = useState("dashboard");

  const cambiar = useCallback((t) => {
    guardarSesionProfe(t);
    setToken(t);
  }, []);
  const salir = useCallback(() => cambiar(null), [cambiar]);

  if (!token) return <EntrarProfe alEntrar={cambiar} />;

  return (
    <div className="inicio">
      <header className="barra">
        <div className="marca">
          <span className="sello-mini" aria-hidden="true">P</span>
          <div>
            <strong>Zona del profesor</strong>
            <span>TeAIch Português</span>
          </div>
        </div>
        <button className="boton-texto" onClick={salir}>
          Salir
        </button>
      </header>
      <nav className="pestanas" aria-label="Secciones">
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            className={s.id === seccion ? "pestana activa" : "pestana"}
            aria-current={s.id === seccion ? "page" : undefined}
            disabled={s.pronto}
            title={s.pronto ? "Disponible pronto" : undefined}
            onClick={() => setSeccion(s.id)}
          >
            {s.titulo}
          </button>
        ))}
      </nav>
      <main className="contenido">
        {seccion === "dashboard" && <Dashboard token={token} salir={salir} />}
        {seccion === "estudiantes" && <Estudiantes token={token} salir={salir} />}
        {seccion === "material" && <Material token={token} salir={salir} />}
        {seccion === "vocabulario" && <VocabularioProfe token={token} salir={salir} />}
      </main>
    </div>
  );
}
