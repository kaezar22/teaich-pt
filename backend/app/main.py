"""API de TeAIch Português (portugués de Brasil para hispanohablantes).

Local:  uvicorn app.main:app --reload   (desde la carpeta backend)
Documentación interactiva: http://localhost:8000/docs
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Literal, Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import asyncio

from . import materiales, supabase, tablero
from .auth import Cupo, Limitador, Tokens, clave_correcta
from .config import config
from .contenido import Contenido, Estudiante, Palabra, Repositorio, Unidad, separar_palabras
from .tutor import (
    DIFICULTADES, TAREAS, TIPOS, Contexto, Tutor, _parecida, comparar, construir_contexto, es_no_se,
    fuera_de_vocabulario, palabras_de,
)
from .voz import MAX_CARACTERES, VOCES, Voz

app = FastAPI(title="TeAIch Português API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.origenes_permitidos,
    allow_methods=["*"],
    allow_headers=["*"],
)

repo = Repositorio(config)
tokens = Tokens(config.app_secret or "solo-para-pruebas")
limitador = Limitador()
voz = Voz()
cupo = Cupo(config.cupo_ia_diario)
_tutor: Tutor | None = None


def tutor() -> Tutor:
    """Cliente de DeepSeek (se crea la primera vez que se usa)."""
    global _tutor
    if _tutor is None:
        if not config.deepseek_api_key:
            raise HTTPException(503, "Falta configurar DEEPSEEK_API_KEY en el servidor.")
        from openai import OpenAI

        cliente = OpenAI(api_key=config.deepseek_api_key, base_url="https://api.deepseek.com", timeout=60)
        _tutor = Tutor(cliente, config.deepseek_model)
    return _tutor
RE_LETRA = re.compile(r"[a-zA-ZÀ-ÿ]")


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def ip_de(request: Request) -> str:
    reenviada = request.headers.get("x-forwarded-for", "")
    return reenviada.split(",")[0].strip() or (request.client.host if request.client else "?")


def contenido() -> Contenido:
    try:
        return repo.obtener()
    except Exception as err:
        raise HTTPException(503, f"No se pudo leer la hoja de Google ({type(err).__name__}).")


def _token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Falta iniciar sesión.")
    return authorization[7:].strip()


def estudiante_actual(authorization: str | None = Header(None)) -> Estudiante:
    sub = tokens.leer(_token(authorization), "estudiante")
    est = contenido().estudiante(sub) if sub else None
    # Se vuelve a comprobar en la hoja: si el profesor lo desactiva, pierde el acceso
    if not est or not est.activo:
        raise HTTPException(401, "Tu sesión ya no es válida. Vuelve a entrar con tu PIN.")
    return est


def profesor_actual(authorization: str | None = Header(None)) -> None:
    if tokens.leer(_token(authorization), "profesor") != "profesor":
        raise HTTPException(401, "Sesión de profesor no válida.")


def _perfil(est: Estudiante, c: Contenido) -> dict:
    esp = c.espacios[est.espacio]
    return {"id": est.id, "nombre": est.nombre, "espacio": esp.id, "espacio_nombre": esp.nombre}


# ---------------------------------------------------------------------------
# Salud
# ---------------------------------------------------------------------------
@app.get("/api/ping")
def ping():
    """Comprobación liviana para Render (no toca Google ni Supabase)."""
    return {"ok": True}


@app.get("/api/salud")
def salud():
    """Revisa la configuración y la conexión con Google Sheets y Supabase."""
    estado = {"configuracion_faltante": config.faltantes()}
    try:
        c = repo.obtener(forzar=True)
        estado["google_sheets"] = {
            "ok": True,
            "espacios": sorted(c.espacios),
            "estudiantes": len(c.estudiantes),
            "unidades": {e: len(u) for e, u in c.unidades.items()},
        }
    except Exception as err:
        estado["google_sheets"] = {"ok": False, "error": f"{type(err).__name__}: {err}"[:300]}
    try:
        r = httpx.get(
            f"{config.supabase_url}/rest/v1/{supabase.PRACTICA}",
            params={"select": "id", "limit": "1"},
            headers={"apikey": config.supabase_secret_key},
            timeout=10,
        )
        estado["supabase"] = {"ok": r.status_code == 200, "codigo": r.status_code}
        if r.status_code != 200:
            estado["supabase"]["error"] = r.text[:300]
    except Exception as err:
        estado["supabase"] = {"ok": False, "error": f"{type(err).__name__}: {err}"[:300]}
    estado["ok"] = not estado["configuracion_faltante"] and estado["google_sheets"]["ok"] and estado["supabase"]["ok"]
    return estado


# ---------------------------------------------------------------------------
# Estudiantes
# ---------------------------------------------------------------------------
class EntradaPin(BaseModel):
    pin: str


@app.post("/api/login")
def login(datos: EntradaPin, request: Request):
    ip = ip_de(request)
    if limitador.bloqueado(ip):
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos.")
    c = contenido()
    est = c.buscar_pin(datos.pin)
    if not est:
        limitador.fallo(ip)
        raise HTTPException(401, "PIN incorrecto.")
    limitador.exito(ip)
    return {"token": tokens.crear("estudiante", est.id), "estudiante": _perfil(est, c)}


@app.get("/api/yo")
def yo(est: Estudiante = Depends(estudiante_actual)):
    return _perfil(est, contenido())


@app.get("/api/curso")
def curso(est: Estudiante = Depends(estudiante_actual)):
    """Niveles y unidades que puede practicar el estudiante, con sus palabras."""
    c = contenido()
    niveles: dict[str, list] = {}
    for u in c.curso(est.espacio):
        niveles.setdefault(u.nivel, []).append({
            "unidad": u.unidad,
            "palabras": [{"pt": p.pt, "es": p.es, "nota": p.nota} for p in u.palabras],
            "frases": len(u.frases),
        })
    esp = c.espacios[est.espacio]
    return {
        "espacio": esp.id,
        "nombre": esp.nombre,
        "restringir_vocabulario": esp.restringir,
        "niveles": [{"nivel": n, "unidades": us} for n, us in niveles.items()],
    }


# ---------------------------------------------------------------------------
# Audio, juegos y tiempo de práctica
# ---------------------------------------------------------------------------
@app.get("/api/audio", responses={200: {"content": {"audio/mpeg": {}}}})
async def audio(
    texto: str = Query(..., max_length=MAX_CARACTERES),
    voz_: Literal["femenina", "masculina"] = Query("femenina", alias="voz"),
    lento: bool = False,
    est: Estudiante = Depends(estudiante_actual),
):
    """MP3 con la pronunciación de un texto en portugués."""
    texto = texto.strip()
    if not RE_LETRA.search(texto):
        raise HTTPException(400, "El texto está vacío.")
    try:
        mp3 = await voz.mp3(texto, voz_, lento)
    except Exception:
        raise HTTPException(503, "No se pudo generar el audio en este momento.")
    return Response(mp3, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


JUEGOS = Literal["pt_es", "es_pt", "audio_pt", "parejas"]
ACTIVIDADES = Literal["vocabulario", "juego", "es_pt", "pt_es", "escucha", "chat", "examen"]


class ResultadoJuego(BaseModel):
    juego: JUEGOS
    nivel: Optional[str] = Field(None, max_length=80)
    unidades: list[int] = Field(default_factory=list, max_length=60)
    preguntas: int = Field(..., ge=1, le=200)
    aciertos: int = Field(..., ge=0, le=200)
    segundos: float = Field(..., ge=0, le=3600)


@app.post("/api/juegos/resultado", status_code=201)
def guardar_resultado(r: ResultadoJuego, est: Estudiante = Depends(estudiante_actual)):
    if r.aciertos > r.preguntas:
        raise HTTPException(422, "Hay más aciertos que preguntas.")
    try:
        supabase.guardar_resultado({
            "estudiante_id": est.id, "espacio": est.espacio, "juego": r.juego, "nivel": r.nivel,
            "unidades": [str(u) for u in r.unidades], "preguntas": r.preguntas, "aciertos": r.aciertos,
            "segundos": round(r.segundos, 1),
        })
    except supabase.ErrorSupabase:
        raise HTTPException(503, "No se pudo guardar el resultado.")
    return {"ok": True}


class Latido(BaseModel):
    actividad: ACTIVIDADES
    practica_id: Optional[int] = None


@app.post("/api/practica/latido")
def practica_latido(datos: Latido, est: Estudiante = Depends(estudiante_actual)):
    """El navegador lo llama cada ~30 s mientras el estudiante practica con la pestaña visible."""
    try:
        pid = supabase.latido(est.id, est.espacio, datos.actividad, datos.practica_id)
    except supabase.ErrorSupabase:
        raise HTTPException(503, "No se pudo registrar el tiempo de práctica.")
    return {"practica_id": pid}


# ---------------------------------------------------------------------------
# Prácticas con IA: traducción, listening, examen y chat
# ---------------------------------------------------------------------------
class Eleccion(BaseModel):
    nivel: str = Field(..., max_length=80)
    unidades: list[int] = Field(..., min_length=1, max_length=60)


def contexto_de(est: Estudiante, e: Eleccion) -> Contexto:
    c = contenido()
    try:
        return construir_contexto(c.curso(est.espacio), e.nivel, e.unidades, c.espacios[est.espacio].restringir)
    except ValueError as err:
        raise HTTPException(422, str(err))


def gastar_cupo(est: Estudiante):
    if not cupo.usar(est.id):
        raise HTTPException(429, "Llegaste al límite de práctica con IA por hoy. Mañana puedes seguir; mientras tanto, prueba los juegos.")


def error_ia(err: Exception) -> HTTPException:
    if isinstance(err, HTTPException):
        return err
    return HTTPException(502, "El tutor no respondió. Inténtalo de nuevo en unos segundos.")


class PedidoFrases(Eleccion):
    cantidad: int = Field(6, ge=1, le=10)
    evitar: list[str] = Field(default_factory=list, max_length=60)


@app.post("/api/practica/frases")
def practica_frases(datos: PedidoFrases, est: Estudiante = Depends(estudiante_actual)):
    """Frases nuevas (portugués y español) para traducir o escuchar."""
    ctx = contexto_de(est, datos)
    gastar_cupo(est)
    try:
        frases = tutor().generar_frases(ctx, datos.cantidad, [e[:80] for e in datos.evitar])
    except Exception as err:
        raise error_ia(err)
    return {"frases": frases}


class PedidoCalificar(BaseModel):
    modo: Literal["es_pt", "pt_es", "dictado", "comprension"]
    enunciado: str = Field(..., max_length=300)
    referencia: str = Field(..., max_length=300)
    respuesta: str = Field(..., max_length=500)


@app.post("/api/practica/calificar")
def practica_calificar(datos: PedidoCalificar, est: Estudiante = Depends(estudiante_actual)):
    tarea = TAREAS[datos.modo]
    t = tutor()
    # En blanco, "no sé" o igual a la referencia (o solo con otras tildes) se califica sin IA ni cupo
    trivial = not datos.respuesta.strip() or es_no_se(datos.respuesta) or comparar(datos.respuesta, datos.referencia) != "distinta"
    if not trivial:
        gastar_cupo(est)
    try:
        return t.calificar(tarea, datos.enunciado, datos.referencia, datos.respuesta)
    except Exception as err:
        raise error_ia(err)


class PedidoExamen(Eleccion):
    dificultad: Literal["Fácil", "Intermedio", "Difícil"] = "Fácil"
    cantidad: int = Field(8, ge=3, le=15)


@app.get("/api/examen/opciones")
def examen_opciones():
    return {
        "dificultades": [{"nombre": n, "ayuda": d["ayuda"]} for n, d in DIFICULTADES.items()],
        "tipos": TIPOS,
    }


@app.post("/api/examen/generar")
def examen_generar(datos: PedidoExamen, est: Estudiante = Depends(estudiante_actual)):
    ctx = contexto_de(est, datos)
    gastar_cupo(est)
    try:
        return {"preguntas": tutor().generar_examen(ctx, datos.dificultad, datos.cantidad)}
    except Exception as err:
        raise error_ia(err)


class ItemExamen(BaseModel):
    id: str = Field(..., max_length=10)
    tipo: Literal["completar", "ordenar", "pt_es", "es_pt", "responder", "lectura", "redaccion"]
    enunciado: str = Field(..., max_length=1500)
    referencia: str = Field(..., max_length=600)
    respuesta: str = Field("", max_length=1000)


class PedidoCalificarExamen(BaseModel):
    items: list[ItemExamen] = Field(..., min_length=1, max_length=40)


@app.post("/api/examen/calificar")
def examen_calificar(datos: PedidoCalificarExamen, est: Estudiante = Depends(estudiante_actual)):
    gastar_cupo(est)
    items = [
        {"id": i.id, "tarea": TIPOS[i.tipo], "enunciado": i.enunciado, "referencia": i.referencia, "respuesta": i.respuesta}
        for i in datos.items
    ]
    try:
        return {"resultados": tutor().calificar_examen(items)}
    except Exception as err:
        raise error_ia(err)


class Mensaje(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)


class PedidoChat(Eleccion):
    historial: list[Mensaje] = Field(..., min_length=1, max_length=40)


@app.post("/api/chat")
def chat(datos: PedidoChat, est: Estudiante = Depends(estudiante_actual)):
    """Respuesta del tutor en texto, enviada a medida que se escribe."""
    if datos.historial[-1].role != "user":
        raise HTTPException(422, "El último mensaje debe ser del estudiante.")
    ctx = contexto_de(est, datos)
    gastar_cupo(est)
    t = tutor()
    try:
        flujo = t.chat(ctx, [m.model_dump() for m in datos.historial])
        primero = next(flujo, "")  # si DeepSeek falla, que falle aquí y no a mitad de la respuesta
    except Exception as err:
        raise error_ia(err)

    def emitir():
        yield primero
        try:
            yield from flujo
        except Exception:
            yield "\n\n(La respuesta se interrumpió. Vuelve a preguntar.)"

    return StreamingResponse(emitir(), media_type="text/plain; charset=utf-8")


# ---------------------------------------------------------------------------
# Profesor
# ---------------------------------------------------------------------------
class EntradaClave(BaseModel):
    clave: str


@app.post("/api/profesor/login")
def profesor_login(datos: EntradaClave, request: Request):
    ip = ip_de(request)
    if limitador.bloqueado(ip):
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos.")
    if not clave_correcta(datos.clave, config.profesor_clave):
        limitador.fallo(ip)
        raise HTTPException(401, "Clave incorrecta.")
    limitador.exito(ip)
    return {"token": tokens.crear("profesor", "profesor")}


@app.get("/api/profesor/resumen", dependencies=[Depends(profesor_actual)])
def profesor_resumen():
    """Espacios, estudiantes y avisos de la hoja (PIN repetidos, filas mal escritas…)."""
    c = contenido()
    return {
        "espacios": [
            {
                "id": e.id,
                "nombre": e.nombre,
                "restringir_vocabulario": e.restringir,
                "incluye": e.incluir,
                "unidades": len(c.curso(e.id)),
                "estudiantes": [
                    {"id": s.id, "nombre": s.nombre, "activo": s.activo} for s in c.estudiantes if s.espacio == e.id
                ],
            }
            for e in c.espacios.values()
        ],
        "avisos": c.avisos,
    }


@app.post("/api/profesor/recargar", dependencies=[Depends(profesor_actual)])
def profesor_recargar():
    """Vuelve a leer la hoja de Google ahora mismo (sin esperar los 5 minutos de caché)."""
    try:
        c = repo.obtener(forzar=True)
    except Exception as err:
        raise HTTPException(503, f"No se pudo leer la hoja de Google ({type(err).__name__}).")
    return {"ok": True, "avisos": c.avisos}


@app.get("/api/profesor/dashboard", dependencies=[Depends(profesor_actual)])
def profesor_dashboard(dias: int = 7):
    """Tiempo de práctica y resultados de juegos de los últimos `dias` días (7, 30 o 90), por espacio y estudiante."""
    if dias not in (7, 30, 90):
        raise HTTPException(422, "El periodo debe ser de 7, 30 o 90 días.")
    c = contenido()
    ahora = supabase.ahora()
    desde = ahora - timedelta(days=dias + 1)  # un día de margen por la zona horaria
    try:
        practica = supabase.leer_desde(supabase.PRACTICA, "id,estudiante_id,espacio,actividad,inicio,segundos", "inicio", desde)
        resultados = supabase.leer_desde(supabase.RESULTADOS, "id,estudiante_id,espacio,preguntas,aciertos,creado", "creado", desde)
    except supabase.ErrorSupabase:
        raise HTTPException(503, "No se pudo leer la actividad de Supabase.")
    inicio_periodo = (ahora.astimezone(ZoneInfo(config.zona_horaria)) - timedelta(days=dias - 1)).date()
    tz = ZoneInfo(config.zona_horaria)
    dentro = lambda f: datetime.fromisoformat(f.replace("Z", "+00:00")).astimezone(tz).date() >= inicio_periodo  # noqa: E731
    practica = [f for f in practica if dentro(f["inicio"])]
    resultados = [r for r in resultados if dentro(r["creado"])]
    return tablero.resumir(c, practica, resultados, dias, ahora, config.zona_horaria)


@app.get("/api/profesor/estudiantes", dependencies=[Depends(profesor_actual)])
def profesor_estudiantes():
    """Estudiantes de la hoja, con su PIN (solo para el profesor)."""
    c = contenido()
    return {
        "espacios": [{"id": e.id, "nombre": e.nombre} for e in c.espacios.values()],
        "estudiantes": [
            {"id": s.id, "nombre": s.nombre, "espacio": s.espacio, "pin": s.pin, "activo": s.activo}
            for s in c.estudiantes
        ],
    }


class NuevoEstudiante(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=80)
    espacio: str = Field(..., max_length=60)
    notas: str = Field("", max_length=200)


@app.post("/api/profesor/estudiantes", status_code=201, dependencies=[Depends(profesor_actual)])
def profesor_crear_estudiante(datos: NuevoEstudiante):
    """Agrega un estudiante a la hoja con un id y un PIN nuevos."""
    c = repo.obtener(forzar=True)
    if datos.espacio not in c.espacios:
        raise HTTPException(422, "Ese espacio no existe.")
    est = Estudiante(
        id=tablero.crear_id(datos.nombre, {s.id for s in c.estudiantes}),
        nombre=datos.nombre.strip(),
        espacio=datos.espacio,
        pin=tablero.crear_pin({s.pin for s in c.estudiantes}),
    )
    try:
        repo.agregar_estudiante(est, datos.notas.strip())
    except Exception as err:
        raise HTTPException(503, f"No se pudo escribir en la hoja de Google ({type(err).__name__}).")
    return {"id": est.id, "nombre": est.nombre, "espacio": est.espacio, "pin": est.pin, "activo": True}


class CambioActivo(BaseModel):
    activo: bool


@app.post("/api/profesor/estudiantes/{estudiante_id}/activo", dependencies=[Depends(profesor_actual)])
def profesor_activar(estudiante_id: str, datos: CambioActivo):
    try:
        encontrado = repo.cambiar_activo(estudiante_id, datos.activo)
    except Exception as err:
        raise HTTPException(503, f"No se pudo escribir en la hoja de Google ({type(err).__name__}).")
    if not encontrado:
        raise HTTPException(404, "No encontré ese estudiante en la hoja.")
    return {"ok": True}



# ---------------------------------------------------------------------------
# Profesor: material para clase
# ---------------------------------------------------------------------------
def _unidad_json(u: Unidad, espacio: str) -> dict:
    return {
        "unidad": u.unidad,
        "propia": u.espacio == espacio,  # False si viene de un espacio incluido
        "palabras": [{"pt": p.pt, "es": p.es, "nota": p.nota} for p in u.palabras],
        "frases": u.frases,
    }


@app.get("/api/profesor/cursos", dependencies=[Depends(profesor_actual)])
def profesor_cursos():
    """Todos los espacios con sus niveles, unidades, palabras y frases."""
    c = contenido()
    espacios = []
    for e in c.espacios.values():
        niveles: dict[str, list] = {}
        for u in c.curso(e.id):
            niveles.setdefault(u.nivel, []).append(_unidad_json(u, e.id))
        espacios.append({
            "id": e.id, "nombre": e.nombre, "restringir_vocabulario": e.restringir, "incluye": e.incluir,
            "niveles": [{"nivel": n, "unidades": us} for n, us in niveles.items()],
        })
    return {"espacios": espacios}


class EleccionProfe(BaseModel):
    espacio: str = Field(..., max_length=60)
    nivel: str = Field(..., max_length=80)
    unidades: list[int] = Field(..., min_length=1, max_length=60)


def contexto_profe(e: EleccionProfe) -> Contexto:
    c = contenido()
    if e.espacio not in c.espacios:
        raise HTTPException(422, "Ese espacio no existe.")
    try:
        return construir_contexto(c.curso(e.espacio), e.nivel, e.unidades, c.espacios[e.espacio].restringir)
    except ValueError as err:
        raise HTTPException(422, str(err))


class PedidoPreguntas(EleccionProfe):
    dificultad: Literal["Fácil", "Intermedio", "Difícil"] = "Intermedio"
    cantidad: int = Field(10, ge=3, le=20)
    tipos: Optional[list[Literal["es_pt", "ordenar", "completar", "responder", "redaccion"]]] = None


@app.post("/api/profesor/material/preguntas", dependencies=[Depends(profesor_actual)])
def profesor_preguntas(datos: PedidoPreguntas):
    """Preguntas de examen (o de escritura, si se indican los tipos) con sus respuestas."""
    ctx = contexto_profe(datos)
    plan = materiales.plan_escritura(datos.tipos, datos.cantidad) if datos.tipos else None
    try:
        return {"preguntas": tutor().generar_examen(ctx, datos.dificultad, datos.cantidad, plan)}
    except Exception as err:
        raise error_ia(err)


class PedidoDocx(BaseModel):
    titulo: str = Field(..., max_length=120)
    descripcion: str = Field("", max_length=300)
    preguntas: list[dict] = Field(..., min_length=1, max_length=40)
    clave: bool = False


def _descarga(contenido_bytes: bytes, tipo: str, nombre: str) -> Response:
    return Response(contenido_bytes, media_type=tipo, headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


@app.post("/api/profesor/material/docx", dependencies=[Depends(profesor_actual)])
def profesor_docx(datos: PedidoDocx):
    """Word con la hoja del estudiante o con la clave de respuestas."""
    for p in datos.preguntas:
        if p.get("tipo") not in TIPOS:
            raise HTTPException(422, "Hay una pregunta con un tipo desconocido.")
    try:
        doc = materiales.doc_examen(datos.titulo, datos.descripcion, datos.preguntas, datos.clave)
    except (KeyError, TypeError):
        raise HTTPException(422, "Las preguntas no tienen el formato esperado.")
    nombre = ("clave" if datos.clave else "hoja") + ".docx"
    return _descarga(doc, materiales.MIME_DOCX, nombre)


class PedidoListening(EleccionProfe):
    titulo: str = Field("Ejercicio de listening", max_length=120)
    descripcion: str = Field("", max_length=300)
    cantidad: int = Field(5, ge=1, le=10)
    dictado: bool = True
    lento: bool = True
    voz: Literal["femenina", "masculina"] = "femenina"


@app.post("/api/profesor/material/listening", dependencies=[Depends(profesor_actual)])
async def profesor_listening(datos: PedidoListening):
    """ZIP con los audios MP3, la hoja del estudiante y la clave."""
    ctx = contexto_profe(datos)
    try:
        frases = await asyncio.to_thread(tutor().generar_frases, ctx, datos.cantidad)
    except Exception as err:
        raise error_ia(err)

    async def audio(f):
        try:
            return await voz.mp3(f["pt"], datos.voz, datos.lento)
        except Exception:
            return None

    audios = await asyncio.gather(*(audio(f) for f in frases))
    paquete = materiales.zip_listening(datos.titulo, datos.descripcion, frases, list(audios), datos.dictado)
    return _descarga(paquete, "application/zip", "listening.zip")


# ---------------------------------------------------------------------------
# Profesor: vocabulario
# ---------------------------------------------------------------------------
RE_ESPACIO = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


class PalabraEntrada(BaseModel):
    pt: str = Field(..., min_length=1, max_length=60)
    es: str = Field("", max_length=120)
    nota: str = Field("", max_length=60)


def _curso_con_unidad(c: Contenido, espacio: str, nivel: str, unidad: int, palabras: list[Palabra]) -> list[Unidad]:
    """El curso del espacio como quedaría con esta unidad (nueva o editada), para revisar el vocabulario."""
    curso = list(c.curso(espacio)) if espacio in c.espacios else []
    nueva = Unidad(nivel=nivel, unidad=unidad, espacio=espacio, palabras=palabras or [Palabra("?")])
    for i, u in enumerate(curso):
        if u.nivel == nivel and u.unidad == unidad:
            curso[i] = nueva
            return curso
    ultimo = max((i for i, u in enumerate(curso) if u.nivel == nivel), default=len(curso) - 1)
    curso.insert(ultimo + 1, nueva)
    return curso


class PedidoCompletar(BaseModel):
    espacio: str = Field(..., max_length=40)
    nivel: str = Field(..., min_length=1, max_length=80)
    unidad: int = Field(..., ge=1, le=999)
    palabras: str = Field(..., max_length=3000)
    frases: list[str] = Field(default_factory=list, max_length=80)
    sugerir_frases: bool = False


def _usada(palabra: str, frases: list[str]) -> bool:
    """¿Aparece la palabra (o una forma suya: falar ~ falo) en alguna frase?"""
    texto = " ".join(frases).lower()
    if palabra.lower() in texto:
        return True
    propias = frozenset(palabras_de(palabra))
    return bool(propias) and any(_parecida(w, propias) for w in palabras_de(texto) if len(w) >= 4)


@app.post("/api/profesor/vocabulario/completar", dependencies=[Depends(profesor_actual)])
def profesor_completar(datos: PedidoCompletar):
    """Significado y nota de cada palabra (de la hoja si ya existen; si no, con IA),
    frases sugeridas y avisos de vocabulario."""
    c = contenido()
    escritas = separar_palabras(datos.palabras)[:150]
    if not escritas:
        raise HTTPException(422, "Escribe al menos una palabra.")
    conocidas: dict[str, Palabra] = {}
    for u in c.unidades.get(datos.espacio, []) + [u for e in c.espacios for u in c.unidades.get(e, [])]:
        for p in u.palabras:
            if p.es:
                conocidas.setdefault(p.pt.lower(), p)
    faltan = [w for w in escritas if w.lower() not in conocidas]
    nuevas: dict[str, dict] = {}
    if faltan:
        try:
            esp = c.espacios.get(datos.espacio)
            contexto = "" if not esp or esp.restringir else f"{datos.nivel}"
            nuevas = {w.lower(): g for w, g in zip(faltan, tutor().glosario(faltan, contexto))}
        except Exception as err:
            raise error_ia(err)
    palabras = []
    for w in escritas:
        if w.lower() in conocidas:
            p = conocidas[w.lower()]
            palabras.append({"pt": p.pt, "es": p.es, "nota": p.nota, "origen": "hoja"})
        else:
            g = nuevas.get(w.lower(), {})
            palabras.append({"pt": g.get("pt") or w, "es": g.get("es", ""), "nota": g.get("nota", ""), "origen": "ia"})

    curso = _curso_con_unidad(c, datos.espacio, datos.nivel, datos.unidad, [Palabra(p["pt"], p["es"], p["nota"]) for p in palabras])
    restringir = c.espacios[datos.espacio].restringir if datos.espacio in c.espacios else True
    ctx = construir_contexto(curso, datos.nivel, [datos.unidad], restringir)
    sugeridas: list[str] = []
    if datos.sugerir_frases:
        try:
            sugeridas = [f for f in tutor().sugerir_frases(ctx) if f not in datos.frases]
        except Exception as err:
            raise error_ia(err)
    frases = [f.strip() for f in datos.frases if f.strip()]
    return {
        "palabras": palabras,
        "frases_sugeridas": sugeridas,
        "sin_usar": [p["pt"] for p in palabras if frases and not _usada(p["pt"], frases)],
        "fuera_de_vocabulario": fuera_de_vocabulario(" ".join(frases + sugeridas), ctx),
    }


class PedidoGuardar(BaseModel):
    espacio: str = Field(..., max_length=40)
    nombre_espacio: str = Field("", max_length=80)
    nivel: str = Field(..., min_length=1, max_length=80)
    unidad: int = Field(..., ge=1, le=999)
    palabras: list[PalabraEntrada] = Field(..., min_length=1, max_length=150)
    frases: list[str] = Field(..., min_length=1, max_length=80)


@app.post("/api/profesor/vocabulario/guardar", dependencies=[Depends(profesor_actual)])
def profesor_guardar_vocabulario(datos: PedidoGuardar):
    """Crea o reemplaza una unidad en las pestañas <espacio>_vocabulario y <espacio>_frases."""
    if not RE_ESPACIO.match(datos.espacio):
        raise HTTPException(422, "El nombre corto del espacio solo puede tener minúsculas, números y guiones.")
    frases = [f.strip()[:300] for f in datos.frases if f.strip()]
    if not frases:
        raise HTTPException(422, "Escribe al menos una frase de entrenamiento.")
    vistas, palabras = set(), []
    for p in datos.palabras:
        w = " ".join(p.pt.split())
        if w and w.lower() not in vistas:
            vistas.add(w.lower())
            palabras.append(Palabra(w, p.es.strip(), p.nota.strip()))
    try:
        repo.guardar_unidad(datos.espacio, datos.nombre_espacio.strip(), datos.nivel.strip(), datos.unidad, palabras, frases)
    except Exception as err:
        raise HTTPException(503, f"No se pudo escribir en la hoja de Google ({type(err).__name__}).")
    return {"ok": True, "palabras": len(palabras), "frases": len(frases)}
