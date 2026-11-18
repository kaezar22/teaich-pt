"""Material para clase en Word (hoja del estudiante y clave), adaptado de zona_profesor.py."""
from __future__ import annotations

import io
import zipfile

from docx import Document
from docx.shared import Pt, RGBColor

from .tutor import TIPOS

MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TIPOS_ESCRITURA = ["es_pt", "ordenar", "completar", "responder", "redaccion"]


def _nuevo_doc(titulo: str, subtitulo: str, estudiante: bool) -> Document:
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name, normal.font.size = "Calibri", Pt(12)
    doc.add_heading(titulo, level=1)
    doc.add_paragraph(subtitulo)
    if estudiante:
        doc.add_paragraph("Nombre: ______________________________     Fecha: ______________")
    return doc


def _pt(doc, texto: str, tam: int = 13):
    """Texto en portugués, un poco más grande y en cursiva para distinguirlo de las instrucciones."""
    run = doc.add_paragraph().add_run(texto)
    run.font.size, run.italic = Pt(tam), True


def _respuesta(doc, texto: str | None, lineas: int = 1):
    """Línea para escribir (hoja del estudiante) o la respuesta en rojo (clave)."""
    if texto is None:
        for _ in range(lineas):
            doc.add_paragraph("_" * 62)
    else:
        run = doc.add_paragraph().add_run(f"Respuesta: {texto}")
        run.font.color.rgb, run.bold = RGBColor(0x00, 0x7A, 0x3D), True


def _bytes(doc) -> bytes:
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def doc_examen(titulo: str, subtitulo: str, preguntas: list[dict], clave: bool) -> bytes:
    doc = _nuevo_doc(titulo + (" — Clave de respuestas" if clave else ""), subtitulo, not clave)
    for i, p in enumerate(preguntas, 1):
        doc.add_paragraph().add_run(f"{i}. {TIPOS[p['tipo']]}").bold = True
        tipo = p["tipo"]
        if tipo == "ordenar":
            _pt(doc, "   /   ".join(p["palabras"]))
            _respuesta(doc, p["respuesta"] if clave else None)
        elif tipo == "redaccion":
            _pt(doc, ",  ".join(p["palabras"]))
            doc.add_paragraph(f"Escribe un texto de unas {p.get('longitud', 40)} palabras.")
            _respuesta(doc, f"(texto modelo) {p['respuesta']}" if clave else None, lineas=4)
        elif tipo == "lectura":
            _pt(doc, p["texto"], 12)
            for j, s in enumerate(p["preguntas"], 1):
                _pt(doc, f"{chr(96 + j)}) {s['enunciado']}", 12)
                _respuesta(doc, s["respuesta"] if clave else None)
        else:
            if tipo == "es_pt":
                doc.add_paragraph(p["enunciado"])
            else:
                _pt(doc, p["enunciado"])
            _respuesta(doc, p["respuesta"] if clave else None)
    return _bytes(doc)


def doc_listening(titulo: str, subtitulo: str, frases: list[dict], dictado: bool, clave: bool) -> bytes:
    doc = _nuevo_doc(titulo + (" — Clave de respuestas" if clave else ""), subtitulo, not clave)
    doc.add_paragraph(
        "Escucha cada audio y escribe la frase en portugués (cuidado con las tildes y la ç)." if dictado
        else "Escucha cada audio y escribe en español qué significa."
    )
    for i, f in enumerate(frases, 1):
        doc.add_paragraph().add_run(f"{i}.  Audio {i:02d}").bold = True
        if clave:
            _pt(doc, f["pt"])
            doc.add_paragraph(f["es"])
        else:
            _respuesta(doc, None, lineas=1 if dictado else 2)
    return _bytes(doc)


def zip_listening(titulo: str, subtitulo: str, frases: list[dict], audios: list[bytes | None], dictado: bool) -> bytes:
    paquete = io.BytesIO()
    with zipfile.ZipFile(paquete, "w", zipfile.ZIP_DEFLATED) as z:
        for i, audio in enumerate(audios, 1):
            if audio:
                z.writestr(f"audio_{i:02d}.mp3", audio)
        z.writestr("hoja_estudiante.docx", doc_listening(titulo, subtitulo, frases, dictado, False))
        z.writestr("clave_respuestas.docx", doc_listening(titulo, subtitulo, frases, dictado, True))
    return paquete.getvalue()


def plan_escritura(tipos: list[str], n: int) -> list[str]:
    """Como en la app Streamlit: redacciones al final, el resto repartido entre los tipos cortos."""
    cortos = [t for t in tipos if t != "redaccion"]
    if "redaccion" not in tipos:
        redacciones = 0
    else:
        redacciones = max(1, min(2, n // 4)) if cortos else min(n, 3)
    plan = [cortos[i % len(cortos)] for i in range(n - redacciones)] if cortos else []
    return plan + ["redaccion"] * redacciones
