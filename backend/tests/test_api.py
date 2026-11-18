"""Pruebas sin conexión: la hoja de Google se reemplaza por datos de ejemplo."""
import pytest
from fastapi.testclient import TestClient

from app import main
from app.contenido import construir

HOJA = {
    "espacios": [
        ["espacio", "nombre", "restringir_vocabulario", "incluir_espacios", "notas"],
        ["javeriana", "Português – Grupo", "sí", "", ""],
        ["personal", "Mi práctica", "no", "javeriana, noexiste", ""],
    ],
    "estudiantes": [
        ["id", "nombre", "espacio", "pin", "activo", "notas"],
        ["ana", "Ana", "javeriana", "123456", "sí", ""],
        ["yo", "Profe", "personal", "654321", "sí", ""],
        ["baja", "Ex estudiante", "javeriana", "111111", "no", ""],
        ["dup1", "Dup 1", "javeriana", "222222", "sí", ""],
        ["dup2", "Dup 2", "javeriana", "222222", "", ""],
    ],
    "javeriana_vocabulario": [
        ["nivel", "unidad", "palavra", "español", "notas"],
        ["Português 1", "1", "professor", "profesor", "m."],
        ["Português 1", "1", "falar", "hablar", "verbo"],
        ["Português 1", "2", "obrigado", "", ""],
        ["Português 2", "1", "chá", "té", "m."],
        ["Português 2", "x", "erro", "error", ""],
    ],
    "javeriana_frases": [["nivel", "unidad", "frase"], ["Português 1", "1", "Eu sou professor."]],
    "personal_vocabulario": [["nivel", "unidad", "palavra", "español", "notas"], ["Negócios", "1", "cliente", "cliente", "m."]],
    "personal_frases": [["nivel", "unidad", "frase"]],
}


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.setattr(main.repo, "_leer_hoja", lambda: HOJA)
    object.__setattr__(main.config, "profesor_clave", "clave-larga-123")
    main.repo.obtener(forzar=True)
    main.limitador._fallos.clear()
    return TestClient(main.app)


def entrar(cliente, pin):
    r = cliente.post("/api/login", json={"pin": pin})
    return r, {"Authorization": f"Bearer {r.json().get('token', '')}"}


def test_construir_avisos():
    c = construir(HOJA)
    texto = " | ".join(c.avisos)
    assert "noexiste" in texto
    assert "'unidad' debe ser un número" in texto
    assert "mismo PIN" in texto
    assert "1 palabras sin significado" in texto
    assert c.espacios["personal"].incluir == ["javeriana"]


def test_login_y_curso(cliente):
    r, cab = entrar(cliente, " 123456 ")
    assert r.status_code == 200
    assert r.json()["estudiante"]["espacio"] == "javeriana"
    curso = cliente.get("/api/curso", headers=cab).json()
    assert [n["nivel"] for n in curso["niveles"]] == ["Português 1", "Português 2"]
    u1 = curso["niveles"][0]["unidades"][0]
    assert [p["pt"] for p in u1["palabras"]] == ["professor", "falar"] and u1["frases"] == 1
    assert u1["palabras"][1] == {"pt": "falar", "es": "hablar", "nota": "verbo"}
    assert curso["restringir_vocabulario"] is True


def test_personal_incluye_javeriana(cliente):
    _, cab = entrar(cliente, "654321")
    curso = cliente.get("/api/curso", headers=cab).json()
    assert [n["nivel"] for n in curso["niveles"]] == ["Português 1", "Português 2", "Negócios"]
    assert curso["restringir_vocabulario"] is False


def test_pines_invalidos(cliente):
    for pin in ("000000", "111111", "222222", ""):
        assert entrar(cliente, pin)[0].status_code == 401


def test_limite_de_intentos(cliente):
    for _ in range(8):
        entrar(cliente, "999999")
    assert entrar(cliente, "123456")[0].status_code == 429


def test_token_falso_y_rol(cliente):
    assert cliente.get("/api/curso", headers={"Authorization": "Bearer falso"}).status_code == 401
    _, cab = entrar(cliente, "123456")
    assert cliente.get("/api/profesor/resumen", headers=cab).status_code == 401


def test_profesor(cliente):
    assert cliente.post("/api/profesor/login", json={"clave": "mala"}).status_code == 401
    tok = cliente.post("/api/profesor/login", json={"clave": "clave-larga-123"}).json()["token"]
    cab = {"Authorization": f"Bearer {tok}"}
    res = cliente.get("/api/profesor/resumen", headers=cab).json()
    assert {e["id"] for e in res["espacios"]} == {"javeriana", "personal"}
    assert res["avisos"]
    assert cliente.get("/api/curso", headers=cab).status_code == 401
