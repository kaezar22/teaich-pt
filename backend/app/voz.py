"""Texto a voz en portugués de Brasil: voces neuronales (edge-tts) y, si fallan, Google (gTTS)."""
from __future__ import annotations

import asyncio
import io
from collections import OrderedDict
from threading import Lock

VOCES = {"femenina": "pt-BR-FranciscaNeural", "masculina": "pt-BR-AntonioNeural"}
MAX_CARACTERES = 200


async def _edge(texto: str, voz: str, lento: bool) -> bytes:
    import edge_tts

    audio = bytearray()
    com = edge_tts.Communicate(texto, voz, rate="-30%" if lento else "-5%")
    async for parte in com.stream():
        if parte["type"] == "audio":
            audio.extend(parte["data"])
    if not audio:
        raise RuntimeError("edge-tts no devolvió audio")
    return bytes(audio)


def _google(texto: str, lento: bool) -> bytes:
    from gtts import gTTS

    buf = io.BytesIO()
    gTTS(texto, lang="pt", tld="com.br", slow=lento).write_to_fp(buf)
    return buf.getvalue()


class Voz:
    """Genera MP3 y guarda los últimos en memoria (las mismas palabras se repiten mucho)."""

    def __init__(self, maximo: int = 800):
        self._cache: OrderedDict[tuple, bytes] = OrderedDict()
        self._maximo = maximo
        self._lock = Lock()

    async def mp3(self, texto: str, voz: str = "femenina", lento: bool = False) -> bytes:
        clave = (texto, voz, lento)
        with self._lock:
            if clave in self._cache:
                self._cache.move_to_end(clave)
                return self._cache[clave]
        try:
            audio = await asyncio.wait_for(_edge(texto, VOCES.get(voz, VOCES["femenina"]), lento), timeout=20)
        except Exception:
            audio = await asyncio.to_thread(_google, texto, lento)
        with self._lock:
            self._cache[clave] = audio
            while len(self._cache) > self._maximo:
                self._cache.popitem(last=False)
        return audio
