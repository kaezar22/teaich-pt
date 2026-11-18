"""Material para clase y carga de vocabulario (DeepSeek, voz y hoja simulados)."""
import io
import json
import zipfile
from types import SimpleNamespace as NS

import pytest
from docx import Document

from app import main
from app.contenido import reemplazar_unidad
from app.materiales import doc_examen, plan_escritura
from app.tutor import Tutor
from tests.test_api import cliente  # noqa: F401
from tests.test_profesor import profe
from tests.test_tutor import DeepSeekFalso


class DeepSeekProfe(DeepSeekFalso):
    def create(self, model, messages, temperature, stream=False, response_format=None):
        pedido = messages[-1]["content"]
        if pedido.startswith("Para cada palabra"):
            lista = pedido.split("Palabras: ", 1)[1].split("\n", 1)[0].split(" | ")
            datos = {"glosario": [{"original": p, "pt": p, "es": f"es-{p}", "nota": "verbo"} for p in lista]}
            self.llamadas.append(messages)
            return NS(choices=[NS(message=NS(content=json.dumps(datos, ensure_ascii=False)))])
        if "para enseñar las palabras" in pedido:
            self.llamadas.append(messages)
            datos = {"frases": ["Eu bebo chá.", "Você bebe café da manhã?"]}
            return NS(choices=[NS(message=NS(content=json.dumps(datos, ensure_ascii=False)))])
        return super().create(model, messages, temperature, stream, response_format)


@pytest.fixture
def ia(monkeypatch):
    falso = DeepSeekProfe()
    monkeypatch.setattr(main, "_tutor", Tutor(falso))
    return falso


PREGUNTAS = [
    {"tipo": "completar", "enunciado": "Eu ____ (falar) português.", "respuesta": "falo"},
    {"tipo": "ordenar", "palabras": ["sou", "Eu", "professor"], "respuesta": "Eu sou professor"},
    {"tipo": "lectura", "texto": "Eu sou professor.", "preguntas": [{"enunciado": "Quem é ele?", "respuesta": "professor"}]},
    {"tipo": "redaccion", "palabras": ["falar", "professor"], "longitud": 20, "respuesta": "O professor fala."},
    {"tipo": "es_pt", "enunciado": "Yo hablo.", "respuesta": "Eu falo."},
]


def texto_docx(datos: bytes) -> str:
    return "\n".join(p.text for p in Document(io.BytesIO(datos)).paragraphs)


def test_reemplazar_unidad():
    cab = ["nivel", "unidad", "frase"]
    valores = [cab, ["A", "1", "x"], ["A", "2", "viejo1"], ["A", "2", "viejo2"], ["B", "1", "y"]]
    assert reemplazar_unidad(valores, cab, "A", 2, [["A", "2", "nuevo"]]) == [cab, ["A", "1", "x"], ["A", "2", "nuevo"], ["B", "1", "y"]]
    assert reemplazar_unidad(valores, cab, "A", 3, [["A", "3", "z"]])[-1] == ["A", "3", "z"]
    assert reemplazar_unidad([], cab, "A", 1, [["A", "1", "z"]]) == [cab, ["A", "1", "z"]]


def test_plan_escritura():
    assert plan_escritura(["es_pt", "ordenar", "redaccion"], 8) == ["es_pt", "ordenar"] * 3 + ["redaccion"] * 2
    assert plan_escritura(["redaccion"], 5) == ["redaccion"] * 3


def test_docx_hoja_y_clave():
    hoja = texto_docx(doc_examen("Quiz", "Português 1", PREGUNTAS, clave=False))
    clave = texto_docx(doc_examen("Quiz", "Português 1", PREGUNTAS, clave=True))
    assert "Nombre:" in hoja and "Respuesta:" not in hoja and "Yo hablo." in hoja
    assert "Clave de respuestas" in clave and "Respuesta: Eu sou professor" in clave


def test_endpoints_material(cliente, ia, monkeypatch):
    cab = profe(cliente)
    base = {"espacio": "javeriana", "nivel": "Português 1", "unidades": [1]}
    r = cliente.post("/api/profesor/material/preguntas", headers=cab, json={**base, "dificultad": "Fácil", "cantidad": 3})
    assert r.status_code == 200 and len(r.json()["preguntas"]) == 3
    r = cliente.post("/api/profesor/material/docx", headers=cab, json={"titulo": "Quiz", "preguntas": PREGUNTAS, "clave": True})
    assert r.status_code == 200 and "Clave" in texto_docx(r.content)
    assert cliente.post("/api/profesor/material/docx", headers=cab, json={"titulo": "Q", "preguntas": [{"tipo": "x"}]}).status_code == 422

    async def mp3(texto, voz, lento):
        return b"ID3audio"
    monkeypatch.setattr(main.voz, "mp3", mp3)
    r = cliente.post("/api/profesor/material/listening", headers=cab, json={**base, "cantidad": 2})
    nombres = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert sorted(nombres) == ["audio_01.mp3", "audio_02.mp3", "clave_respuestas.docx", "hoja_estudiante.docx"]
    # Solo el profesor
    from tests.test_api import entrar
    _, cab_est = entrar(cliente, "123456")
    assert cliente.post("/api/profesor/material/preguntas", headers=cab_est, json=base).status_code == 401


def test_completar_vocabulario(cliente, ia):
    cab = profe(cliente)
    r = cliente.post("/api/profesor/vocabulario/completar", headers=cab, json={
        "espacio": "javeriana", "nivel": "Português 1", "unidad": 3, "palabras": "Professor, beber\ncafé da manhã\nBEBER",
        "frases": ["Eu bebo água."], "sugerir_frases": True})
    d = r.json()
    assert r.status_code == 200
    assert d["palabras"][0] == {"pt": "professor", "es": "profesor", "nota": "m.", "origen": "hoja"}  # ya estaba en la hoja
    assert d["palabras"][1] == {"pt": "beber", "es": "es-beber", "nota": "verbo", "origen": "ia"}
    assert [p["pt"] for p in d["palabras"]] == ["professor", "beber", "café da manhã"]  # sin repetidos, expresiones enteras
    assert d["frases_sugeridas"] == ["Eu bebo chá.", "Você bebe café da manhã?"]
    assert d["sin_usar"] == ["professor", "café da manhã"]  # 'bebo' cuenta como uso de 'beber'
    assert d["fuera_de_vocabulario"] == ["chá", "água"]  # 'você' y 'eu' son básicas; chá es de Português 2
    # Solo se le pidió a la IA lo que faltaba
    assert "professor" not in ia.llamadas[0][-1]["content"].lower().split("palabras: ")[1].split("\n")[0]


def test_guardar_vocabulario(cliente, monkeypatch):
    guardado = {}
    monkeypatch.setattr(main.repo, "guardar_unidad", lambda *a: guardado.update(args=a))
    cab = profe(cliente)
    datos = {"espacio": "negocios", "nombre_espacio": "Cursos de negocios", "nivel": "Básico", "unidad": 1,
             "palabras": [{"pt": "cliente", "es": "cliente", "nota": "m."}, {"pt": " Cliente "}], "frases": ["Ele é cliente.", " "]}
    r = cliente.post("/api/profesor/vocabulario/guardar", headers=cab, json=datos)
    assert r.json() == {"ok": True, "palabras": 1, "frases": 1}
    esp, nombre, nivel, unidad, palabras, frases = guardado["args"]
    assert (esp, nombre, nivel, unidad, frases) == ("negocios", "Cursos de negocios", "Básico", 1, ["Ele é cliente."])
    assert cliente.post("/api/profesor/vocabulario/guardar", headers=cab, json={**datos, "espacio": "Mal Nombre"}).status_code == 422


class HojaFalsa:
    """Imita lo justo de gspread para Repositorio.guardar_unidad."""

    class Pestana:
        def __init__(self, titulo, valores=None):
            self.title, self.valores, self.row_count, self.col_count = titulo, valores or [], 100, 5

        def get_all_values(self):
            return [list(f) for f in self.valores]

        def row_values(self, n):
            return self.valores[n - 1]

        def append_row(self, fila, value_input_option=None):
            self.valores.append(fila)

        def add_rows(self, n):
            self.row_count += n

        def add_cols(self, n):
            self.col_count += n

        def update(self, values, range_name, value_input_option=None):
            assert range_name == "A1" and value_input_option == "RAW"
            assert len(values) <= self.row_count
            self.valores = [f for f in values if any(f)]

        def format(self, *a):
            pass

        def freeze(self, rows):
            pass

    def __init__(self, pestanas):
        self.pestanas = {p.title: p for p in pestanas}

    def worksheets(self):
        return list(self.pestanas.values())

    def add_worksheet(self, title, rows, cols):
        self.pestanas[title] = HojaFalsa.Pestana(title)
        return self.pestanas[title]


def test_guardar_unidad_en_hoja(monkeypatch):
    from app.contenido import Palabra
    from tests.test_api import HOJA

    P = HojaFalsa.Pestana
    vocab = P("javeriana_vocabulario", [list(f) for f in HOJA["javeriana_vocabulario"]])
    espacios = P("espacios", [list(f) for f in HOJA["espacios"]])
    hoja = HojaFalsa([espacios, vocab, P("javeriana_frases", [list(f) for f in HOJA["javeriana_frases"]])])
    repo = main.repo
    monkeypatch.setattr(repo, "_cliente", lambda: NS(open_by_key=lambda _id: hoja))
    monkeypatch.setattr(repo, "_leer_hoja", lambda: HOJA)
    repo.obtener(forzar=True)

    # Editar Português 1 unidad 1 (tenía professor y falar) deja la unidad en su lugar
    repo.guardar_unidad("javeriana", "", "Português 1", 1, [Palabra("ele", "él", "pronombre")], ["Ele é professor."])
    assert vocab.valores[1] == ["Português 1", "1", "ele", "él", "pronombre"]
    assert vocab.valores[2][:3] == ["Português 1", "2", "obrigado"] and len(vocab.valores) == len(HOJA["javeriana_vocabulario"]) - 1

    # Un espacio nuevo crea sus pestañas y su fila en 'espacios'
    repo.guardar_unidad("negocios", "Cursos de negocios", "Básico", 1, [Palabra("cliente", "cliente", "m.")], ["Ele é cliente."])
    assert hoja.pestanas["negocios_vocabulario"].valores == [["nivel", "unidad", "palavra", "español", "notas"], ["Básico", "1", "cliente", "cliente", "m."]]
    assert espacios.valores[-1][:3] == ["negocios", "Cursos de negocios", "sí"]
