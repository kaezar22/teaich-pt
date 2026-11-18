"""Dashboard del profesor: tiempo de práctica y resultados por espacio y estudiante."""
from __future__ import annotations

import re
import secrets
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .contenido import Contenido


def _fecha(valor: str) -> datetime:
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


def resumir(c: Contenido, practica: list[dict], resultados: list[dict], dias: int, ahora: datetime, zona: str) -> dict:
    tz = ZoneInfo(zona)
    hoy = ahora.astimezone(tz).date()
    fechas = [hoy - timedelta(days=i) for i in range(dias - 1, -1, -1)]

    por_est: dict[str, dict] = defaultdict(lambda: {
        "segundos": 0, "dias": set(), "ultima": None, "por_actividad": defaultdict(int),
        "rondas": 0, "preguntas": 0, "aciertos": 0, "espacio": None,
    })
    por_dia: dict[str, dict[date, int]] = defaultdict(lambda: defaultdict(int))

    for f in practica:
        seg = int(f.get("segundos") or 0)
        if seg <= 0:
            continue
        momento = _fecha(f["inicio"])
        dia = momento.astimezone(tz).date()
        e = por_est[f["estudiante_id"]]
        e["espacio"] = f["espacio"]
        e["segundos"] += seg
        e["dias"].add(dia)
        e["por_actividad"][f["actividad"]] += seg
        e["ultima"] = max(e["ultima"] or momento, momento)
        por_dia[f["espacio"]][dia] += seg

    for r in resultados:
        e = por_est[r["estudiante_id"]]
        e["espacio"] = e["espacio"] or r["espacio"]
        e["rondas"] += 1
        e["preguntas"] += int(r["preguntas"])
        e["aciertos"] += int(r["aciertos"])
        momento = _fecha(r["creado"])
        e["ultima"] = max(e["ultima"] or momento, momento)

    espacios = []
    for esp in c.espacios.values():
        filas = []
        conocidos = [s for s in c.estudiantes if s.espacio == esp.id]
        ids = {s.id for s in conocidos}
        # Estudiantes que practicaron pero ya no están en la hoja (o cambiaron de espacio)
        extra = [i for i, e in por_est.items() if e["espacio"] == esp.id and i not in ids and not c.estudiante(i)]
        for est_id, nombre, activo in [(s.id, s.nombre, s.activo) for s in conocidos] + [(i, i, False) for i in extra]:
            e = por_est.get(est_id)
            filas.append({
                "id": est_id,
                "nombre": nombre,
                "activo": activo,
                "segundos": e["segundos"] if e else 0,
                "dias_activos": len(e["dias"]) if e else 0,
                "ultima": e["ultima"].isoformat() if e and e["ultima"] else None,
                "por_actividad": dict(e["por_actividad"]) if e else {},
                "juegos": {"rondas": e["rondas"], "preguntas": e["preguntas"], "aciertos": e["aciertos"]} if e else
                          {"rondas": 0, "preguntas": 0, "aciertos": 0},
            })
        filas.sort(key=lambda x: (-x["segundos"], x["nombre"].lower()))
        espacios.append({
            "id": esp.id,
            "nombre": esp.nombre,
            "segundos": sum(x["segundos"] for x in filas),
            "con_practica": sum(1 for x in filas if x["segundos"] > 0),
            "estudiantes": filas,
            "por_dia": [{"fecha": d.isoformat(), "segundos": por_dia[esp.id].get(d, 0)} for d in fechas],
        })
    return {"dias": dias, "hasta": hoy.isoformat(), "espacios": espacios}


# ---------------------------------------------------------------------------
# Nuevos estudiantes
# ---------------------------------------------------------------------------
def crear_id(nombre: str, existentes: set[str]) -> str:
    base = unicodedata.normalize("NFKD", nombre.lower())
    base = re.sub(r"[^a-z0-9]+", "-", "".join(ch for ch in base if not unicodedata.combining(ch))).strip("-")[:30] or "estudiante"
    candidato, n = base, 2
    while candidato in existentes:
        candidato, n = f"{base}-{n}", n + 1
    return candidato


def crear_pin(existentes: set[str]) -> str:
    while True:
        pin = f"{secrets.randbelow(900000) + 100000}"
        if pin not in existentes:
            return pin
