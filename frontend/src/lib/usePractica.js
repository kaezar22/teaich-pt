import { useEffect } from "react";
import { api } from "../api.js";

const CADA = 30_000; // un latido cada 30 s
const INACTIVO = 120_000; // sin tocar nada por 2 min, deja de contar

// Registra el tiempo de práctica mientras la pestaña está visible y el estudiante está activo.
export function usePractica(token, actividad) {
  useEffect(() => {
    let practicaId = null;
    let ultimaAccion = Date.now();
    let cancelado = false;
    let enCurso = null; // evita crear dos sesiones a la vez

    const marcar = () => (ultimaAccion = Date.now());
    const latir = async (final = false) => {
      if (enCurso) return;
      if (!final && (document.visibilityState !== "visible" || Date.now() - ultimaAccion > INACTIVO)) return;
      enCurso = api
        .latido(token, actividad, practicaId)
        .then((r) => {
          if (!cancelado) practicaId = r.practica_id;
        })
        .catch(() => {
          /* sin conexión: se intenta en el próximo latido */
        })
        .finally(() => (enCurso = null));
    };

    // Se empieza a contar tras un momento, para no registrar visitas de un instante
    const arranque = setTimeout(latir, 1500);
    const intervalo = setInterval(latir, CADA);
    window.addEventListener("pointerdown", marcar);
    window.addEventListener("keydown", marcar);
    return () => {
      clearTimeout(arranque);
      clearInterval(intervalo);
      window.removeEventListener("pointerdown", marcar);
      window.removeEventListener("keydown", marcar);
      if (practicaId) latir(true); // cierra el último tramo
      cancelado = true;
    };
  }, [token, actividad]);
}
