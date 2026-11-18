"""Dashboard y gestión de estudiantes del profesor."""
from datetime import datetime, timezone

import pytest

from app import main, supabase, tablero
from app.contenido import construir
from tests.test_api import HOJA, cliente  # noqa: F401

AHORA = datetime(2026, 10, 19, 15, 0, tzinfo=timezone.utc)  # 10:00 en Bogotá


def profe(cliente):
    tok = cliente.post("/api/profesor/login", json={"clave": "clave-larga-123"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


PRACTICA = [
    {"id": 1, "estudiante_id": "ana", "espacio": "javeriana", "actividad": "juego", "inicio": "2026-10-19T14:00:00+00:00", "segundos": 600},
    {"id": 2, "estudiante_id": "ana", "espacio": "javeriana", "actividad": "chat", "inicio": "2026-10-18T14:00:00+00:00", "segundos": 300},
    # 03:00 UTC del 19 = 22:00 del 18 en Bogotá
    {"id": 3, "estudiante_id": "ana", "espacio": "javeriana", "actividad": "juego", "inicio": "2026-10-19T03:00:00+00:00", "segundos": 60},
    {"id": 4, "estudiante_id": "yo", "espacio": "personal", "actividad": "es_pt", "inicio": "2026-10-19T13:00:00+00:00", "segundos": 120},
    {"id": 5, "estudiante_id": "borrado", "espacio": "javeriana", "actividad": "juego", "inicio": "2026-10-19T13:00:00+00:00", "segundos": 30},
    {"id": 6, "estudiante_id": "ana", "espacio": "javeriana", "actividad": "juego", "inicio": "2026-10-19T13:00:00+00:00", "segundos": 0},
]
RESULTADOS = [
    {"id": 1, "estudiante_id": "ana", "espacio": "javeriana", "preguntas": 10, "aciertos": 8, "creado": "2026-10-19T14:10:00+00:00"},
    {"id": 2, "estudiante_id": "ana", "espacio": "javeriana", "preguntas": 5, "aciertos": 2, "creado": "2026-10-18T14:10:00+00:00"},
]


def test_resumir():
    r = tablero.resumir(construir(HOJA), PRACTICA, RESULTADOS, 7, AHORA, "America/Bogota")
    jav = next(e for e in r["espacios"] if e["id"] == "javeriana")
    ana = jav["estudiantes"][0]
    assert ana["id"] == "ana" and ana["segundos"] == 960 and ana["dias_activos"] == 2
    assert ana["por_actividad"] == {"juego": 660, "chat": 300}
    assert ana["juegos"] == {"rondas": 2, "preguntas": 15, "aciertos": 10}
    assert jav["por_dia"][-1] == {"fecha": "2026-10-19", "segundos": 630}  # incluye al estudiante borrado
    assert jav["por_dia"][-2] == {"fecha": "2026-10-18", "segundos": 360}
    assert len(jav["por_dia"]) == 7
    # el estudiante que ya no está en la hoja aparece con su id
    assert any(e["id"] == "borrado" and not e["activo"] for e in jav["estudiantes"])
    assert jav["con_practica"] == 2  # ana y borrado; los demás en 0


def test_dashboard_endpoint(cliente, monkeypatch):
    assert (supabase.PRACTICA, supabase.RESULTADOS) == ("pt_practica", "pt_resultados_juego")  # no toca las tablas del chino
    monkeypatch.setattr(supabase, "ahora", lambda: AHORA)
    monkeypatch.setattr(supabase, "leer_desde", lambda tabla, *a, **k: PRACTICA if tabla == supabase.PRACTICA else RESULTADOS)
    cab = profe(cliente)
    r = cliente.get("/api/profesor/dashboard", params={"dias": 7}, headers=cab)
    assert r.status_code == 200 and r.json()["hasta"] == "2026-10-19"
    assert cliente.get("/api/profesor/dashboard", params={"dias": 5}, headers=cab).status_code == 422
    assert cliente.get("/api/profesor/dashboard").status_code == 401


def test_crear_estudiante(cliente, monkeypatch):
    agregados = []
    monkeypatch.setattr(main.repo, "agregar_estudiante", lambda est, notas="": agregados.append(est))
    cab = profe(cliente)
    r = cliente.post("/api/profesor/estudiantes", headers=cab, json={"nombre": "Ana", "espacio": "javeriana"})
    assert r.status_code == 201
    d = r.json()
    assert d["id"] == "ana-2"  # 'ana' ya existe
    assert len(d["pin"]) == 6 and d["pin"] not in {"123456", "654321", "111111", "222222"}
    assert cliente.post("/api/profesor/estudiantes", headers=cab, json={"nombre": "X", "espacio": "nada"}).status_code == 422


def test_lista_con_pin_solo_profesor(cliente):
    from tests.test_api import entrar
    _, cab_est = entrar(cliente, "123456")
    assert cliente.get("/api/profesor/estudiantes", headers=cab_est).status_code == 401
    lista = cliente.get("/api/profesor/estudiantes", headers=profe(cliente)).json()
    assert {"id": "ana", "nombre": "Ana", "espacio": "javeriana", "pin": "123456", "activo": True} in lista["estudiantes"]


def test_ids():
    assert tablero.crear_id("María José Pérez", set()) == "maria-jose-perez"
    assert tablero.crear_id("王 小明", set()) == "estudiante"
