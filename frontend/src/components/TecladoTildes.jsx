import { LETRAS_PT } from "../lib/juegos.js";

// Botones para escribir tildes y ç sin cambiar la configuración del teclado
export default function TecladoTildes({ entrada, setTexto }) {
  function poner(letra) {
    const el = entrada.current;
    if (!el) return;
    const ini = el.selectionStart ?? el.value.length;
    const fin = el.selectionEnd ?? el.value.length;
    const nuevo = el.value.slice(0, ini) + letra + el.value.slice(fin);
    setTexto(nuevo);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + letra.length, ini + letra.length);
    });
  }
  return (
    <div className="teclado-tildes" aria-label="Letras del portugués">
      {LETRAS_PT.map((l) => (
        <button key={l} type="button" className="tecla" onMouseDown={(e) => e.preventDefault()} onClick={() => poner(l)}>
          {l}
        </button>
      ))}
    </div>
  );
}
