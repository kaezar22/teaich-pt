"""Configuración leída de variables de entorno.

En tu computador se leen del archivo .env de la raíz del proyecto.
En Render se configuran en Environment.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]  # carpeta TeAIch-pt
load_dotenv(RAIZ / ".env")


def _lista(valor: str) -> list[str]:
    return [v.strip() for v in valor.split(",") if v.strip()]


@dataclass(frozen=True)
class Config:
    google_sheet_id: str = os.getenv("GOOGLE_SHEET_ID", "")
    # Local: ruta al archivo google.json. En Render: el contenido del JSON en GOOGLE_CREDENTIALS_JSON.
    google_credentials_file: str = os.getenv("GOOGLE_CREDENTIALS_FILE", "google.json")
    google_credentials_json: str = os.getenv("GOOGLE_CREDENTIALS_JSON", "")
    supabase_url: str = os.getenv("SUPABASE_URL", "").rstrip("/")
    supabase_secret_key: str = os.getenv("SUPABASE_SECRET_KEY", "")
    # Se comparte el proyecto de Supabase con la app de chino, con tablas propias
    tabla_practica: str = os.getenv("TABLA_PRACTICA", "pt_practica")
    tabla_resultados: str = os.getenv("TABLA_RESULTADOS", "pt_resultados_juego")
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    # Máximo de pedidos a la IA por estudiante al día (cuida el presupuesto de DeepSeek)
    cupo_ia_diario: int = int(os.getenv("CUPO_IA_DIARIO", "300"))
    profesor_clave: str = os.getenv("PROFESOR_CLAVE", "")
    app_secret: str = os.getenv("APP_SECRET", "")
    # Zona horaria para agrupar la práctica por día en el dashboard
    zona_horaria: str = os.getenv("ZONA_HORARIA", "America/Bogota")
    # Cada cuánto se vuelve a leer la hoja de Google (segundos)
    cache_segundos: int = int(os.getenv("CACHE_SEGUNDOS", "300"))
    origenes_permitidos: list[str] = field(
        default_factory=lambda: _lista(os.getenv("FRONTEND_ORIGINS", "http://localhost:5173"))
    )

    def ruta_credenciales(self) -> Path:
        ruta = Path(self.google_credentials_file)
        return ruta if ruta.is_absolute() else RAIZ / ruta

    def faltantes(self) -> list[str]:
        """Variables obligatorias que no están configuradas."""
        faltan = []
        if not self.google_sheet_id:
            faltan.append("GOOGLE_SHEET_ID")
        if not self.google_credentials_json and not self.ruta_credenciales().exists():
            faltan.append("GOOGLE_CREDENTIALS_JSON o GOOGLE_CREDENTIALS_FILE")
        for nombre in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "DEEPSEEK_API_KEY", "PROFESOR_CLAVE", "APP_SECRET"):
            if not getattr(self, nombre.lower()):
                faltan.append(nombre)
        return faltan


config = Config()
