"""Contenido del curso, espacios y estudiantes, leídos de Google Sheets.

Pestañas esperadas en la hoja:
  espacios               espacio | nombre | restringir_vocabulario | incluir_espacios | notas
  estudiantes            id | nombre | espacio | pin | activo | notas
  <espacio>_vocabulario  nivel | unidad | palavra | español | notas
  <espacio>_frases       nivel | unidad | frase
"""
from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field

SI = {"sí", "si", "s", "yes", "y", "true", "1", "x"}


@dataclass
class Palabra:
    pt: str            # palabra o expresión en portugués (Brasil)
    es: str = ""       # significado en español
    nota: str = ""     # opcional: género, tipo de palabra, "falso cognato"…


@dataclass
class Unidad:
    nivel: str
    unidad: int
    espacio: str  # espacio donde está escrita la unidad
    palabras: list[Palabra] = field(default_factory=list)
    frases: list[str] = field(default_factory=list)


@dataclass
class Espacio:
    id: str
    nombre: str
    restringir: bool = True
    incluir: list[str] = field(default_factory=list)


@dataclass
class Estudiante:
    id: str
    nombre: str
    espacio: str
    pin: str
    activo: bool = True


@dataclass
class Contenido:
    espacios: dict[str, Espacio]
    estudiantes: list[Estudiante]
    unidades: dict[str, list[Unidad]]  # unidades escritas en cada espacio, en el orden de la hoja
    avisos: list[str]

    def curso(self, espacio_id: str) -> list[Unidad]:
        """Unidades que ve un espacio: primero las de los espacios incluidos, luego las propias.

        Si una misma (nivel, unidad) aparece en dos espacios, gana la del propio espacio.
        """
        espacio = self.espacios.get(espacio_id)
        if not espacio:
            return []
        por_clave: dict[tuple[str, int], Unidad] = {}
        for origen in [*espacio.incluir, espacio_id]:
            for u in self.unidades.get(origen, []):
                por_clave.pop((u.nivel, u.unidad), None)  # reordena si se reemplaza
                por_clave[(u.nivel, u.unidad)] = u
        return list(por_clave.values())

    def buscar_pin(self, pin: str) -> Estudiante | None:
        pin = (pin or "").strip()
        if not pin:
            return None
        for e in self.estudiantes:
            if e.activo and e.pin == pin and e.espacio in self.espacios:
                return e
        return None

    def estudiante(self, estudiante_id: str) -> Estudiante | None:
        return next((e for e in self.estudiantes if e.id == estudiante_id), None)


# ---------------------------------------------------------------------------
# Lectura de filas (sin depender de Google, para poder probarla)
# ---------------------------------------------------------------------------
def _filas(valores: list[list[str]]) -> list[dict[str, str]]:
    """Primera fila = encabezados. Devuelve una lista de dicts con texto limpio."""
    if not valores:
        return []
    cab = [str(c).strip().lower() for c in valores[0]]
    salida = []
    for fila in valores[1:]:
        d = {cab[i]: str(v).strip() for i, v in enumerate(fila) if i < len(cab) and cab[i]}
        if any(d.values()):
            salida.append(d)
    return salida


def _si(valor: str, defecto: bool) -> bool:
    return defecto if not valor else valor.strip().lower() in SI


def construir(pestanas: dict[str, list[list[str]]]) -> Contenido:
    """pestanas: {nombre de pestaña: valores (lista de filas)} -> Contenido."""
    avisos: list[str] = []

    espacios: dict[str, Espacio] = {}
    for f in _filas(pestanas.get("espacios", [])):
        eid = f.get("espacio", "").lower()
        if not eid:
            continue
        espacios[eid] = Espacio(
            id=eid,
            nombre=f.get("nombre") or eid,
            restringir=_si(f.get("restringir_vocabulario", ""), True),
            incluir=[x.strip().lower() for x in f.get("incluir_espacios", "").split(",") if x.strip()],
        )
    # Espacios con pestaña de vocabulario pero sin fila en 'espacios'
    for nombre in pestanas:
        if nombre.endswith("_vocabulario"):
            eid = nombre[: -len("_vocabulario")].lower()
            if eid not in espacios:
                espacios[eid] = Espacio(id=eid, nombre=eid)
                avisos.append(f"El espacio '{eid}' tiene vocabulario pero no está en la pestaña 'espacios'.")
    for e in espacios.values():
        for inc in e.incluir:
            if inc not in espacios:
                avisos.append(f"El espacio '{e.id}' incluye '{inc}', que no existe.")
        e.incluir = [i for i in e.incluir if i in espacios and i != e.id]

    unidades: dict[str, list[Unidad]] = {}
    for eid in espacios:
        indice: dict[tuple[str, int], Unidad] = {}
        orden: list[Unidad] = []

        def unidad_de(f: dict, pestana: str, n: int) -> Unidad | None:
            nivel = f.get("nivel", "")
            try:
                num = int(float(f.get("unidad", "")))
            except ValueError:
                avisos.append(f"{pestana}, fila {n}: la columna 'unidad' debe ser un número.")
                return None
            if not nivel:
                avisos.append(f"{pestana}, fila {n}: falta el nivel.")
                return None
            clave = (nivel, num)
            if clave not in indice:
                indice[clave] = Unidad(nivel=nivel, unidad=num, espacio=eid)
                orden.append(indice[clave])
            return indice[clave]

        pv = f"{eid}_vocabulario"
        sin_traduccion = 0
        for n, f in enumerate(_filas(pestanas.get(pv, [])), start=2):
            pt = f.get("palavra") or f.get("palabra") or f.get("português") or ""
            if not pt:
                continue
            u = unidad_de(f, pv, n)
            if u and not any(p.pt.lower() == pt.lower() for p in u.palabras):
                es = f.get("español", f.get("espanol", ""))
                u.palabras.append(Palabra(pt, es, f.get("notas", f.get("nota", ""))))
                sin_traduccion += not es
        if sin_traduccion:
            avisos.append(f"{pv}: {sin_traduccion} palabras sin significado en español.")

        pf = f"{eid}_frases"
        for n, f in enumerate(_filas(pestanas.get(pf, [])), start=2):
            if f.get("frase"):
                u = unidad_de(f, pf, n)
                if u:
                    u.frases.append(f["frase"])
        unidades[eid] = orden

    estudiantes: list[Estudiante] = []
    vistos_id: set[str] = set()
    pines: dict[str, str] = {}
    for n, f in enumerate(_filas(pestanas.get("estudiantes", [])), start=2):
        eid, pin = f.get("id", ""), f.get("pin", "")
        if not eid:
            continue
        if eid in vistos_id:
            avisos.append(f"estudiantes, fila {n}: el id '{eid}' está repetido; se ignora esta fila.")
            continue
        vistos_id.add(eid)
        est = Estudiante(eid, f.get("nombre") or eid, f.get("espacio", "").lower(), pin, _si(f.get("activo", ""), True))
        if est.espacio not in espacios:
            avisos.append(f"estudiantes: '{eid}' está en el espacio '{est.espacio}', que no existe.")
        if est.activo and pin:
            if len(pin) < 6:
                avisos.append(f"estudiantes: el PIN de '{eid}' tiene menos de 6 caracteres.")
            if pin in pines:
                avisos.append(f"estudiantes: '{eid}' y '{pines[pin]}' tienen el mismo PIN; ninguno de los dos podrá entrar.")
                est.activo = False
                otro = next(e for e in estudiantes if e.id == pines[pin])
                otro.activo = False
            else:
                pines[pin] = eid
        estudiantes.append(est)

    return Contenido(espacios, estudiantes, unidades, avisos)


def separar_palabras(texto: str) -> list[str]:
    """Una palabra o expresión por línea, o separadas por comas ('casa, bom dia') -> ['casa', 'bom dia'].

    Las expresiones de varias palabras se conservan (no se separa por espacios)."""
    palabras: list[str] = []
    for p in re.split(r"[\n,;]+", texto or ""):
        p = re.sub(r"\s+", " ", p).strip()
        if p and p.lower() not in {x.lower() for x in palabras}:
            palabras.append(p)
    return palabras


def reemplazar_unidad(valores: list[list[str]], encabezado: list[str], nivel: str, unidad: int,
                      nuevas: list[list[str]]) -> list[list[str]]:
    """Devuelve la pestaña con las filas de (nivel, unidad) reemplazadas por `nuevas`, en el mismo lugar.

    Si la unidad no existía, las filas nuevas van al final. Se conservan las demás filas tal cual.
    """
    if not valores:
        return [encabezado] + nuevas
    cab = [str(c).strip().lower() for c in valores[0]]
    i_niv, i_uni = cab.index("nivel"), cab.index("unidad")

    def es_de_la_unidad(fila: list[str]) -> bool:
        try:
            return fila[i_niv].strip() == nivel and int(float(fila[i_uni])) == unidad
        except (IndexError, ValueError):
            return False

    salida, puestas = [valores[0]], False
    for fila in valores[1:]:
        if es_de_la_unidad(fila):
            if not puestas:
                salida += nuevas
                puestas = True
            continue
        salida.append(fila)
    if not puestas:
        salida += nuevas
    return salida


# ---------------------------------------------------------------------------
# Repositorio: lee la hoja de Google y la guarda en caché
# ---------------------------------------------------------------------------
class Repositorio:
    def __init__(self, cfg):
        self.cfg = cfg
        self._contenido: Contenido | None = None
        self._leido = 0.0
        self._lock = threading.Lock()

    def _cliente(self):
        import gspread

        if self.cfg.google_credentials_json:
            return gspread.service_account_from_dict(json.loads(self.cfg.google_credentials_json))
        return gspread.service_account(filename=str(self.cfg.ruta_credenciales()))

    def _leer_hoja(self) -> dict[str, list[list[str]]]:
        hoja = self._cliente().open_by_key(self.cfg.google_sheet_id)
        titulos = [ws.title for ws in hoja.worksheets()]
        utiles = [t for t in titulos if t in ("espacios", "estudiantes") or t.endswith(("_vocabulario", "_frases"))]
        # Una sola llamada para todas las pestañas
        respuesta = hoja.values_batch_get([f"'{t}'" for t in utiles])
        return {t: r.get("values", []) for t, r in zip(utiles, respuesta.get("valueRanges", []))}

    # -- escritura en la pestaña 'estudiantes' -------------------------------
    def _pestana_estudiantes(self):
        return self._cliente().open_by_key(self.cfg.google_sheet_id).worksheet("estudiantes")

    def agregar_estudiante(self, est: Estudiante, notas: str = "") -> None:
        ws = self._pestana_estudiantes()
        cab = [c.strip().lower() for c in ws.row_values(1)]
        valores = {"id": est.id, "nombre": est.nombre, "espacio": est.espacio, "pin": est.pin,
                   "activo": "sí" if est.activo else "no", "notas": notas}
        # RAW: el PIN se guarda como texto
        ws.append_row([valores.get(c, "") for c in cab], value_input_option="RAW")
        self.obtener(forzar=True)

    def cambiar_activo(self, estudiante_id: str, activo: bool) -> bool:
        ws = self._pestana_estudiantes()
        valores = ws.get_all_values()
        cab = [c.strip().lower() for c in valores[0]]
        col_id, col_act = cab.index("id"), cab.index("activo")
        for n, fila in enumerate(valores[1:], start=2):
            if len(fila) > col_id and fila[col_id].strip() == estudiante_id:
                ws.update_cell(n, col_act + 1, "sí" if activo else "no")
                self.obtener(forzar=True)
                return True
        return False

    # -- escritura de una unidad de vocabulario -----------------------------
    def guardar_unidad(self, espacio: str, nombre_espacio: str, nivel: str, unidad: int,
                       palabras: list[Palabra], frases: list[str]) -> None:
        hoja = self._cliente().open_by_key(self.cfg.google_sheet_id)
        existentes = {ws.title: ws for ws in hoja.worksheets()}

        if "espacios" in existentes and espacio not in self.obtener().espacios:
            cab = [c.strip().lower() for c in existentes["espacios"].row_values(1)]
            fila = {"espacio": espacio, "nombre": nombre_espacio or espacio, "restringir_vocabulario": "sí"}
            existentes["espacios"].append_row([fila.get(c, "") for c in cab], value_input_option="RAW")

        cambios = [
            (f"{espacio}_vocabulario", ["nivel", "unidad", "palavra", "español", "notas"],
             [[nivel, str(unidad), p.pt, p.es, p.nota] for p in palabras]),
            (f"{espacio}_frases", ["nivel", "unidad", "frase"], [[nivel, str(unidad), f] for f in frases]),
        ]
        for titulo, encabezado, nuevas in cambios:
            ws = existentes.get(titulo) or hoja.add_worksheet(title=titulo, rows=200, cols=len(encabezado))
            valores = ws.get_all_values()
            final = reemplazar_unidad(valores, encabezado, nivel, unidad, nuevas)
            ancho = max(len(f) for f in final)
            final = [f + [""] * (ancho - len(f)) for f in final]
            # Se borran las filas sobrantes (si la unidad quedó más corta) y se escribe todo de una vez
            sobrantes = len(valores) - len(final)
            if len(final) > ws.row_count:
                ws.add_rows(len(final) - ws.row_count + 50)
            if ancho > ws.col_count:
                ws.add_cols(ancho - ws.col_count)
            ws.update(values=final + [[""] * ancho] * max(0, sobrantes), range_name="A1", value_input_option="RAW")
            if not valores:
                ws.format("A1:Z1", {"textFormat": {"bold": True}})
                ws.freeze(rows=1)
        self.obtener(forzar=True)

    def obtener(self, forzar: bool = False) -> Contenido:
        with self._lock:
            vencido = time.time() - self._leido > self.cfg.cache_segundos
            if self._contenido is None or forzar or vencido:
                try:
                    self._contenido = construir(self._leer_hoja())
                    self._leido = time.time()
                except Exception:
                    if self._contenido is None:
                        raise
                    # Si Google falla, seguimos con la última versión buena
                    self._leido = time.time() - self.cfg.cache_segundos + 30
            return self._contenido
