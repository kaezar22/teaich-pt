import { StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { guardarSesion, leerSesion } from "./api.js";
import Entrar from "./pages/Entrar.jsx";
import Inicio from "./pages/Inicio.jsx";
import Profesor from "./pages/profesor/Profesor.jsx";

const esProfesor = window.location.pathname.replace(/\/$/, "") === "/profesor";

function App() {
  const [sesion, setSesion] = useState(leerSesion);

  const cambiar = useCallback((nueva) => {
    guardarSesion(nueva);
    setSesion(nueva);
  }, []);
  const salir = useCallback(() => cambiar(null), [cambiar]);

  return sesion ? (
    <Inicio sesion={sesion} salir={salir} />
  ) : (
    <Entrar alEntrar={cambiar} />
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {esProfesor ? <Profesor /> : <App />}
  </StrictMode>,
);
