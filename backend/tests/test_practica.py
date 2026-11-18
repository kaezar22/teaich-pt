"""Juegos, tiempo de práctica y audio, con Supabase y la voz simulados."""
from datetime import datetime, timedelta, timezone

import pytest

from app import main, supabase
from tests.test_api import cliente, entrar  # noqa: F401  (fixture y ayuda)


class SupabaseFalso:
    def __init__(self):
        self.tablas = {"practica": [], "resultados_juego": []}
        self.nombres = {supabase.PRACTICA: "practica", supabase.RESULTADOS: "resultados_juego"}

    def pedir(self, metodo, tabla, *, params=None, json=None, devolver=False):
        filas = self.tablas[self.nombres[tabla]]
        if metodo == "POST":
            fila = {"id": len(filas) + 1, **json}
            filas.append(fila)
            return [fila] if devolver else None
        if metodo == "PATCH":
            pid = int(params["id"].split(".")[1])
            next(f for f in filas if f["id"] == pid).update(json)

    def leer(self, tabla, params):
        pid, est = int(params["id"].split(".")[1]), params["estudiante_id"].split(".", 1)[1]
        return [f for f in self.tablas[self.nombres[tabla]] if f["id"] == pid and f["estudiante_id"] == est]


@pytest.fixture
def db(monkeypatch):
    falso = SupabaseFalso()
    monkeypatch.setattr(supabase, "_pedir", falso.pedir)
    monkeypatch.setattr(supabase, "_leer", falso.leer)
    return falso


def test_resultado_juego(cliente, db):
    _, cab = entrar(cliente, "123456")
    r = cliente.post("/api/juegos/resultado", headers=cab, json={
        "juego": "pt_es", "nivel": "Português 1", "unidades": [1, 2], "preguntas": 10, "aciertos": 7, "segundos": 41.26})
    assert r.status_code == 201
    fila = db.tablas["resultados_juego"][0]
    assert fila["estudiante_id"] == "ana" and fila["espacio"] == "javeriana" and fila["segundos"] == 41.3
    # validaciones
    malo = {"juego": "pt_es", "preguntas": 5, "aciertos": 6, "segundos": 3}
    assert cliente.post("/api/juegos/resultado", headers=cab, json=malo).status_code == 422
    malo = {"juego": "otro", "preguntas": 5, "aciertos": 1, "segundos": 3}
    assert cliente.post("/api/juegos/resultado", headers=cab, json=malo).status_code == 422
    assert cliente.post("/api/juegos/resultado", json=malo).status_code == 401


def test_latidos_suman_tiempo_con_tope(cliente, db, monkeypatch):
    t0 = datetime(2026, 10, 19, 15, 0, tzinfo=timezone.utc)
    reloj = {"t": t0}
    monkeypatch.setattr(supabase, "ahora", lambda: reloj["t"])
    _, cab = entrar(cliente, "123456")

    pid = cliente.post("/api/practica/latido", headers=cab, json={"actividad": "juego"}).json()["practica_id"]
    reloj["t"] = t0 + timedelta(seconds=30)
    cliente.post("/api/practica/latido", headers=cab, json={"actividad": "juego", "practica_id": pid})
    reloj["t"] = t0 + timedelta(minutes=20)  # la pestaña estuvo dormida: solo cuenta el tope
    cliente.post("/api/practica/latido", headers=cab, json={"actividad": "juego", "practica_id": pid})
    assert db.tablas["practica"][0]["segundos"] == 30 + supabase.MAX_SEGUNDOS_POR_LATIDO

    # Otro estudiante no puede sumar a una sesión ajena: se le crea una nueva
    _, cab2 = entrar(cliente, "654321")
    pid2 = cliente.post("/api/practica/latido", headers=cab2, json={"actividad": "juego", "practica_id": pid}).json()["practica_id"]
    assert pid2 != pid and db.tablas["practica"][1]["estudiante_id"] == "yo"


def test_audio(cliente, monkeypatch):
    async def mp3(texto, voz, lento):
        return b"ID3" + texto.encode()
    monkeypatch.setattr(main.voz, "mp3", mp3)
    _, cab = entrar(cliente, "123456")
    r = cliente.get("/api/audio", params={"texto": "Bom dia, professora!", "lento": "true"}, headers=cab)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert cliente.get("/api/audio", params={"texto": " ?! "}, headers=cab).status_code == 400
    assert cliente.get("/api/audio", params={"texto": "olá"}).status_code == 401
    assert cliente.get("/api/audio", params={"texto": "a" * 201}, headers=cab).status_code == 422
