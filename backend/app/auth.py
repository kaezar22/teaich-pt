"""Inicio de sesión: PIN para estudiantes, contraseña para el profesor.

Al entrar se entrega un token firmado que el navegador envía en cada petición
(cabecera Authorization: Bearer <token>).
"""
from __future__ import annotations

import hmac
import threading
import time
from collections import defaultdict, deque

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

DURACION_ESTUDIANTE = 30 * 24 * 3600  # 30 días
DURACION_PROFESOR = 12 * 3600         # 12 horas


class Tokens:
    def __init__(self, secreto: str):
        self._s = URLSafeTimedSerializer(secreto, salt="teaich-sesion")

    def crear(self, rol: str, sujeto: str) -> str:
        return self._s.dumps({"rol": rol, "sub": sujeto})

    def leer(self, token: str, rol: str) -> str | None:
        """Devuelve el sujeto si el token es válido, del rol pedido y no ha vencido."""
        duracion = DURACION_PROFESOR if rol == "profesor" else DURACION_ESTUDIANTE
        try:
            datos = self._s.loads(token, max_age=duracion)
        except (BadSignature, SignatureExpired):
            return None
        return datos.get("sub") if datos.get("rol") == rol else None


def clave_correcta(intento: str, correcta: str) -> bool:
    return bool(correcta) and hmac.compare_digest((intento or "").strip().encode(), correcta.encode())


class Limitador:
    """Máximo `maximo` intentos fallidos por IP en `ventana` segundos."""

    def __init__(self, maximo: int = 8, ventana: int = 600):
        self.maximo, self.ventana = maximo, ventana
        self._fallos: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _limpiar(self, ip: str, ahora: float):
        q = self._fallos[ip]
        while q and ahora - q[0] > self.ventana:
            q.popleft()

    def bloqueado(self, ip: str) -> bool:
        with self._lock:
            self._limpiar(ip, time.time())
            return len(self._fallos[ip]) >= self.maximo

    def fallo(self, ip: str):
        with self._lock:
            self._fallos[ip].append(time.time())

    def exito(self, ip: str):
        with self._lock:
            self._fallos.pop(ip, None)


class Cupo:
    """Cuántos pedidos a la IA hace cada estudiante por día (se reinicia a medianoche UTC)."""

    def __init__(self, maximo: int):
        self.maximo = maximo
        self._dia = ""
        self._usos: dict[str, int] = defaultdict(int)
        self._lock = threading.Lock()

    def usar(self, quien: str) -> bool:
        hoy = time.strftime("%Y-%m-%d", time.gmtime())
        with self._lock:
            if hoy != self._dia:
                self._dia, self._usos = hoy, defaultdict(int)
            if self._usos[quien] >= self.maximo:
                return False
            self._usos[quien] += 1
            return True
