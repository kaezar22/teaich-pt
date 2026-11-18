"""Prácticas con IA, con DeepSeek simulado."""
import json
from types import SimpleNamespace as NS

import pytest

from app import main
from app.auth import Cupo
from app.contenido import construir
from app.tutor import Tutor, comparar, construir_contexto, fuera_de_vocabulario
from tests.test_api import HOJA, cliente, entrar  # noqa: F401


class DeepSeekFalso:
    """Imita client.chat.completions.create de la librería openai."""

    def __init__(self):
        self.llamadas = []
        self.chat = NS(completions=NS(create=self.create))

    def create(self, model, messages, temperature, stream=False, response_format=None):
        self.llamadas.append(messages)
        pedido = messages[-1]["content"]
        if stream:
            return iter([NS(choices=[NS(delta=NS(content=t))]) for t in ["Usa ", "**no**", " (em + o)."]])
        if "frases distintas" in pedido:
            datos = {"frases": [
                {"pt": "Eu sou professor.", "es": "Soy profesor."},
                {"pt": "Você fala?", "es": "¿Usted habla?"},
                {"pt": "Eu bebo cerveja.", "es": "Tomo cerveza."},  # beber y cerveja no están en Português 1 u1
            ]}
        elif "Califica cada ítem" in pedido:
            items = json.loads(pedido.split("\n", 1)[1].rsplit("\nDevuelve", 1)[0])
            datos = {"resultados": [{"id": it["id"], "puntaje": 0.5, "feedback": "Casi."} for it in items]}
        elif "examen de práctica" in pedido:
            datos = {"preguntas": [
                {"tipo": "completar", "enunciado": "Eu __ (falar) português.", "respuesta": "falo"},
                {"tipo": "pt_es", "enunciado": "Você fala?", "respuesta": "¿Usted habla?"},
                {"tipo": "ordenar", "palabras": ["Eu", "sou", "professor"], "respuesta": "Eu sou professor"},
                {"tipo": "inventado", "enunciado": "x", "respuesta": "y"},
            ]}
        else:
            datos = {}
        return NS(choices=[NS(message=NS(content=json.dumps(datos, ensure_ascii=False)))])


@pytest.fixture
def ia(monkeypatch):
    falso = DeepSeekFalso()
    monkeypatch.setattr(main, "_tutor", Tutor(falso))
    monkeypatch.setattr(main, "cupo", Cupo(50))
    return falso


ELECCION = {"nivel": "Português 1", "unidades": [1]}


def test_contexto_y_vocabulario():
    c = construir(HOJA)
    ctx = construir_contexto(c.curso("javeriana"), "Português 1", [2], True)
    assert [p.pt for p in ctx.foco] == ["obrigado"]
    assert [p.pt for p in ctx.previas] == ["professor", "falar"]  # la unidad 1 ya es conocida
    # formas conjugadas y femeninas de palabras conocidas, y palabras gramaticales, no cuentan como nuevas
    assert fuera_de_vocabulario("Obrigada, professora! Eu falo com você.", ctx) == []
    assert fuera_de_vocabulario("Eu bebo chá.", ctx) == ["bebo", "chá"]  # chá es de Português 2: aún no se ve
    libre = construir_contexto(c.curso("personal"), "Negócios", [1], False)
    assert fuera_de_vocabulario("Eu bebo chá.", libre) == []
    with pytest.raises(ValueError):
        construir_contexto(c.curso("javeriana"), "Negócios", [1])


def test_comparar_tildes():
    assert comparar("Não sei.", "não sei") == "exacta"
    assert comparar("nao sei", "Não sei") == "tildes"
    assert comparar("informacao", "informação") == "tildes"
    assert comparar("no sé", "não sei") == "distinta"


def test_frases_prefiere_vocabulario_conocido(cliente, ia):
    _, cab = entrar(cliente, "123456")
    r = cliente.post("/api/practica/frases", headers=cab, json={**ELECCION, "cantidad": 2})
    assert r.status_code == 200
    assert [f["pt"] for f in r.json()["frases"]] == ["Eu sou professor.", "Você fala?"]
    # El prompt incluye el significado y la nota de la hoja, y pide portugués de Brasil
    sistema = ia.llamadas[0][0]["content"]
    assert "falar (hablar, verbo)" in sistema and "pt-BR" in sistema


def test_eleccion_invalida(cliente, ia):
    _, cab = entrar(cliente, "123456")
    r = cliente.post("/api/practica/frases", headers=cab, json={"nivel": "Negócios", "unidades": [1]})
    assert r.status_code == 422  # 'Negócios' no es del espacio javeriana


def test_calificar(cliente, ia):
    _, cab = entrar(cliente, "123456")
    base = {"modo": "pt_es", "enunciado": "Tudo bem?", "referencia": "¿Cómo estás?"}
    assert cliente.post("/api/practica/calificar", headers=cab, json={**base, "respuesta": "como estas"}).json()["puntaje"] == 1
    assert cliente.post("/api/practica/calificar", headers=cab, json={**base, "respuesta": "no sé"}).json()["sin_respuesta"]
    dictado = {"modo": "dictado", "enunciado": "(audio)", "referencia": "Você não está."}
    r = cliente.post("/api/practica/calificar", headers=cab, json={**dictado, "respuesta": "voce nao esta"}).json()
    assert r["puntaje"] == 1 and r["tildes"] and "Você não está." in r["feedback"]
    assert not ia.llamadas  # sin IA para lo obvio
    r = cliente.post("/api/practica/calificar", headers=cab, json={**base, "respuesta": "¿estás bien?"}).json()
    assert r == {"puntaje": 0.5, "feedback": "Casi."}
    assert "Ignora puntuación" in ia.llamadas[0][0]["content"]


def test_examen(cliente, ia):
    _, cab = entrar(cliente, "123456")
    r = cliente.post("/api/examen/generar", headers=cab, json={**ELECCION, "dificultad": "Fácil", "cantidad": 3})
    preguntas = r.json()["preguntas"]
    assert [p["tipo"] for p in preguntas] == ["completar", "pt_es", "ordenar"]
    assert preguntas[0]["enunciado"] == "Eu ____ (falar) português."
    assert sorted(preguntas[2]["palabras"]) == ["Eu", "professor", "sou"] and preguntas[2]["respuesta"] == "Eu sou professor"
    items = [{"id": "0", "tipo": "completar", "enunciado": "Eu ____ (falar) português.", "referencia": "falo", "respuesta": "Falo"},
             {"id": "1", "tipo": "pt_es", "enunciado": "Você fala?", "referencia": "¿Usted habla?", "respuesta": "¿hablas?"},
             {"id": "2", "tipo": "ordenar", "enunciado": "sou / Eu / professor", "referencia": "Eu sou professor", "respuesta": ""}]
    res = cliente.post("/api/examen/calificar", headers=cab, json={"items": items}).json()["resultados"]
    assert res["0"]["puntaje"] == 1 and res["1"]["puntaje"] == 0.5 and res["2"]["sin_respuesta"]


def test_chat_en_streaming(cliente, ia):
    _, cab = entrar(cliente, "123456")
    r = cliente.post("/api/chat", headers=cab, json={**ELECCION, "historial": [{"role": "user", "content": "¿Cuándo uso 'no'?"}]})
    assert r.status_code == 200 and r.text == "Usa **no** (em + o)."
    r = cliente.post("/api/chat", headers=cab, json={**ELECCION, "historial": [{"role": "assistant", "content": "hola"}]})
    assert r.status_code == 422


def test_cupo_diario(cliente, ia, monkeypatch):
    monkeypatch.setattr(main, "cupo", Cupo(1))
    _, cab = entrar(cliente, "123456")
    assert cliente.post("/api/practica/frases", headers=cab, json=ELECCION).status_code == 200
    assert cliente.post("/api/practica/frases", headers=cab, json=ELECCION).status_code == 429


def test_error_de_deepseek(cliente, ia, monkeypatch):
    def falla(**_):
        raise TimeoutError()
    monkeypatch.setattr(ia.chat.completions, "create", falla)
    _, cab = entrar(cliente, "123456")
    r = cliente.post("/api/practica/frases", headers=cab, json=ELECCION)
    assert r.status_code == 502 and "no respondió" in r.json()["detail"]
