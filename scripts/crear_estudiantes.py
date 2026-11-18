"""Crea las pestañas 'espacios' y 'estudiantes' en la Google Sheet.

Uso:  python crear_estudiantes.py
No borra nada: si una pestaña ya existe, la deja como está.
"""
import secrets
from pathlib import Path

import gspread

AQUI = Path(__file__).parent


def _hoja_id() -> str:
    """GOOGLE_SHEET_ID del archivo .env de TeAIch-pt (nunca la hoja de la app de chino)."""
    for linea in (AQUI.parent / ".env").read_text(encoding="utf-8").splitlines():
        if linea.strip().startswith("GOOGLE_SHEET_ID="):
            return linea.split("=", 1)[1].strip().strip('"')
    raise SystemExit("Falta GOOGLE_SHEET_ID en .env")


HOJA_ID = _hoja_id()


def pin() -> str:
    return f"{secrets.randbelow(900000) + 100000}"  # 6 dígitos al azar


PESTANAS = {
    "espacios": [
        ["espacio", "nombre", "restringir_vocabulario", "incluir_espacios", "notas"],
        ["portugues", "Português do Brasil", "sí", "", "Português 1 (A1) y Português 2 (A2); solo usa palabras ya vistas"],
    ],
    "estudiantes": [
        ["id", "nombre", "espacio", "pin", "activo", "notas"],
        ["prueba", "Estudiante de prueba", "portugues", pin(), "sí", "Para probar la app como estudiante"],
    ],
}

hoja = gspread.service_account(filename=AQUI.parent / "google.json").open_by_key(HOJA_ID)
existentes = {ws.title for ws in hoja.worksheets()}
for nombre, filas in PESTANAS.items():
    if nombre in existentes:
        print(f"  {nombre}: ya existe, no la toco")
        continue
    ws = hoja.add_worksheet(title=nombre, rows=200, cols=len(filas[0]))
    # RAW: el PIN queda como texto (no se pierden ceros ni se convierte en número)
    ws.update(values=filas, range_name="A1", value_input_option="RAW")
    ws.format("A1:Z1", {"textFormat": {"bold": True}})
    ws.freeze(rows=1)
    print(f"  {nombre}: creada")
print("Listo.")
