import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const LARGO = 6;

export default function Entrar({ alEntrar }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const campo = useRef(null);

  // Al terminar un intento (p. ej. PIN incorrecto), el cursor vuelve a las casillas
  useEffect(() => {
    if (!enviando) campo.current?.focus();
  }, [enviando]);

  async function enviar(valor) {
    if (valor.length < LARGO || enviando) return;
    setEnviando(true);
    setError("");
    try {
      const r = await api.entrar(valor);
      alEntrar({ token: r.token, estudiante: r.estudiante });
    } catch (e) {
      setError(e.codigo === 401 ? "Ese PIN no es válido. Revísalo con tu profesor." : e.message);
      setPin("");
    } finally {
      setEnviando(false);
    }
  }

  function cambiar(e) {
    const valor = e.target.value.replace(/\D/g, "").slice(0, LARGO);
    setPin(valor);
    setError("");
    if (valor.length === LARGO) enviar(valor);
  }

  return (
    <main className="entrar">
      <div className="sello" aria-hidden="true">
        <span>Oi!</span>
      </div>
      <h1>Practica portugués de Brasil con el vocabulario de tu clase</h1>
      <form
        className="pin"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(pin);
        }}
      >
        <label htmlFor="pin">Escribe tu PIN</label>
        <div className="pin-casillas" onClick={() => campo.current?.focus()}>
          <input
            id="pin"
            ref={campo}
            value={pin}
            onChange={cambiar}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={LARGO}
            disabled={enviando}
            aria-describedby="pin-ayuda"
            aria-invalid={Boolean(error)}
          />
          {Array.from({ length: LARGO }, (_, i) => (
            <span key={i} className={i === pin.length ? "casilla actual" : "casilla"} aria-hidden="true">
              {pin[i] ? "•" : ""}
            </span>
          ))}
        </div>
        <p id="pin-ayuda" className={error ? "aviso error" : "aviso"} role={error ? "alert" : undefined}>
          {enviando ? "Entrando…" : error || "Son 6 dígitos. Te lo da tu profesor."}
        </p>
      </form>
      <a className="enlace-profe" href="/profesor">
        Zona del profesor
      </a>
    </main>
  );
}
