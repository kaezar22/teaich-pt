"""Carga el vocabulario y las frases iniciales en la Google Sheet.

Uso (desde esta carpeta):
    pip install gspread
    python cargar_hoja.py

Necesita google.json (clave de la cuenta de servicio) en la carpeta principal del proyecto,
y que la hoja esté compartida con la cuenta de servicio como Editor.
"""
import json
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
ENCABEZADOS = {
    "vocabulario": ["nivel", "unidad", "palavra", "español", "notas"],
    "frases": ["nivel", "unidad", "frase"],
}

cliente = gspread.service_account(filename=AQUI.parent / "google.json")
print("Cuenta de servicio:", json.loads((AQUI.parent / "google.json").read_text(encoding="utf-8"))["client_email"])
hoja = cliente.open_by_key(HOJA_ID)
print("Hoja encontrada:", hoja.title)

datos = json.loads((AQUI / "datos_iniciales.json").read_text(encoding="utf-8"))
existentes = {ws.title: ws for ws in hoja.worksheets()}
for nombre, filas in datos.items():
    encabezado = ENCABEZADOS[nombre.split("_", 1)[1]]
    ws = existentes.get(nombre) or hoja.add_worksheet(title=nombre, rows=len(filas) + 50, cols=len(encabezado))
    ws.clear()
    # RAW: se guarda el texto tal cual, sin que Sheets lo convierta en fechas o números
    ws.update(values=[encabezado] + filas, range_name="A1", value_input_option="RAW")
    ws.format("A1:Z1", {"textFormat": {"bold": True}})
    ws.freeze(rows=1)
    print(f"  {nombre}: {len(filas)} filas")
print("Listo.")
