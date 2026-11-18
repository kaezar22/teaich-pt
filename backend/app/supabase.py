"""Acceso mínimo a Supabase por su API REST (PostgREST), con la secret key del backend."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from .config import config

# Tablas propias de la versión de portugués: comparte el proyecto de Supabase con la app de chino
# sin mezclar datos (la app de chino usa 'practica' y 'resultados_juego').
PRACTICA = config.tabla_practica
RESULTADOS = config.tabla_resultados

# Un latido cuenta como máximo esto, aunque haya pasado más tiempo (pestaña dormida, pérdida de red…)
MAX_SEGUNDOS_POR_LATIDO = 45


class ErrorSupabase(Exception):
    pass


def _cabeceras(extra: dict | None = None) -> dict:
    return {"apikey": config.supabase_secret_key, "Content-Type": "application/json", **(extra or {})}


def _pedir(metodo: str, tabla: str, *, params=None, json=None, devolver=False):
    try:
        r = httpx.request(
            metodo,
            f"{config.supabase_url}/rest/v1/{tabla}",
            params=params,
            json=json,
            headers=_cabeceras({"Prefer": "return=representation"} if devolver else None),
            timeout=10,
        )
    except httpx.HTTPError as err:
        raise ErrorSupabase(type(err).__name__) from err
    if r.status_code >= 300:
        raise ErrorSupabase(f"{r.status_code}: {r.text[:200]}")
    return r.json() if devolver else None


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def guardar_resultado(fila: dict) -> None:
    _pedir("POST", RESULTADOS, json=fila)


def latido(estudiante_id: str, espacio: str, actividad: str, practica_id: int | None) -> int:
    """Suma tiempo a una sesión de práctica y devuelve su id (crea una nueva si hace falta).

    El tiempo se calcula en el servidor (desde el latido anterior), no lo dice el navegador.
    """
    momento = ahora()
    if practica_id:
        filas = _leer(PRACTICA, {"id": f"eq.{practica_id}", "estudiante_id": f"eq.{estudiante_id}",
                                   "select": "id,segundos,ultimo_latido,actividad"})
        if filas and filas[0]["actividad"] == actividad:
            fila = filas[0]
            anterior = datetime.fromisoformat(fila["ultimo_latido"].replace("Z", "+00:00"))
            suma = max(0, min(MAX_SEGUNDOS_POR_LATIDO, int((momento - anterior).total_seconds())))
            _pedir(
                "PATCH", PRACTICA,
                params={"id": f"eq.{practica_id}"},
                json={"segundos": fila["segundos"] + suma, "ultimo_latido": momento.isoformat()},
            )
            return fila["id"]
    nueva = _pedir(
        "POST", PRACTICA,
        json={"estudiante_id": estudiante_id, "espacio": espacio, "actividad": actividad,
              "inicio": momento.isoformat(), "ultimo_latido": momento.isoformat(), "segundos": 0},
        devolver=True,
    )
    return nueva[0]["id"]


def _leer(tabla: str, params: dict) -> list[dict]:
    try:
        r = httpx.get(f"{config.supabase_url}/rest/v1/{tabla}", params=params, headers=_cabeceras(), timeout=10)
    except httpx.HTTPError as err:
        raise ErrorSupabase(type(err).__name__) from err
    if r.status_code >= 300:
        raise ErrorSupabase(f"{r.status_code}: {r.text[:200]}")
    return r.json()


def leer_desde(tabla: str, columnas: str, campo_fecha: str, desde: datetime, maximo: int = 20000) -> list[dict]:
    """Filas creadas desde una fecha, de 1000 en 1000 (límite por página de Supabase)."""
    filas: list[dict] = []
    while len(filas) < maximo:
        pagina = _leer(tabla, {
            "select": columnas,
            campo_fecha: f"gte.{desde.isoformat()}",
            "order": f"{campo_fecha}.asc,id.asc",
            "limit": "1000",
            "offset": str(len(filas)),
        })
        filas += pagina
        if len(pagina) < 1000:
            break
    return filas
