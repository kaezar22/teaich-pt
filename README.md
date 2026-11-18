# TeAIch Português

Asistente para enseñar **portugués de Brasil** a hispanohablantes (pensado para estudiantes colombianos):
práctica con el vocabulario de cada unidad, juegos, traducción, listening, tutora con IA, examen de prueba
y zona del profesor. Es una copia (fork) de TeAIch (mandarín); la app de chino no se modifica.

- `backend/`: API en Python (FastAPI), se despliega en Render.
- `frontend/`: interfaz web (React + Vite), se despliega en Vercel.
- `scripts/`: utilidades de configuración (Google Sheets, Supabase) y el contenido inicial.

## Contenido

Google Sheet propia (`GOOGLE_SHEET_ID` en `.env`), con las pestañas:

- `espacios`: espacio | nombre | restringir_vocabulario | incluir_espacios | notas
- `estudiantes`: id | nombre | espacio | pin | activo | notas
- `portugues_vocabulario`: nivel | unidad | **palavra | español | notas** (notas: m./f., verbo, expresión, *falso cognato*…)
- `portugues_frases`: nivel | unidad | frase

Curso inicial (`scripts/datos_iniciales.json`, generado y cargado con `scripts/cargar_hoja.py`):

- Português 1 (A1): 1 Saudações e apresentações · 2 Família e números · 3 Rotina e horas · 4 Comida e restaurante · 5 A cidade e o transporte
- Português 2 (A2): 1 Compras e roupas · 2 O fim de semana passado · 3 Saúde e corpo · 4 Trabalho e estudos · 5 Viagens e falsos amigos

## Actividad de los estudiantes

Se usa el **mismo proyecto de Supabase** que la app de chino, con tablas propias `pt_practica` y
`pt_resultados_juego` (crearlas una vez con `scripts/supabase_tablas.sql`). Se pueden cambiar con
`TABLA_PRACTICA` y `TABLA_RESULTADOS`.

## Diferencias con la versión de chino

- Juegos: palavra → significado, significado → palavra (escrito, con teclado de tildes y aviso de tildes),
  audio → palavra, emparejar.
- Calificación: si solo fallan tildes o ç, cuenta como correcta y se muestra la forma correcta.
- Prompts de DeepSeek: portugués de Brasil, comparando con el español (falsos cognatos, contracciones, portuñol).
- Voz: pt-BR-FranciscaNeural / pt-BR-AntonioNeural (edge-tts), con gTTS de respaldo.
- Sin evaluación de pronunciación.

Los secretos van en `.env` y `google.json`, que no se suben al repositorio.
