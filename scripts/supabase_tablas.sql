-- TeAIch Português: tablas de actividad de los estudiantes.
-- Se crean en el MISMO proyecto de Supabase que la app de chino, con prefijo pt_,
-- para no mezclar datos (la app de chino usa 'practica' y 'resultados_juego').
-- Ejecutar una vez en Supabase > SQL Editor.

create table if not exists pt_practica (
  id             bigint generated always as identity primary key,
  estudiante_id  text        not null,
  espacio        text        not null,
  actividad      text        not null,  -- vocabulario, juego, es_pt, pt_es, escucha, chat, examen
  inicio         timestamptz not null default now(),
  ultimo_latido  timestamptz not null default now(),
  segundos       integer     not null default 0 check (segundos >= 0)
);
create index if not exists pt_practica_estudiante_idx on pt_practica (estudiante_id, inicio desc);
create index if not exists pt_practica_espacio_idx    on pt_practica (espacio, inicio desc);

create table if not exists pt_resultados_juego (
  id             bigint generated always as identity primary key,
  estudiante_id  text        not null,
  espacio        text        not null,
  juego          text        not null,  -- pt_es, es_pt, audio_pt, parejas
  nivel          text,
  unidades       text[],
  preguntas      integer     not null check (preguntas > 0),
  aciertos       integer     not null check (aciertos >= 0),
  segundos       numeric(7,1) not null,
  creado         timestamptz not null default now()
);
create index if not exists pt_resultados_estudiante_idx on pt_resultados_juego (estudiante_id, creado desc);

-- Con RLS activo y sin políticas, solo el backend (con la secret key) accede.
alter table pt_practica         enable row level security;
alter table pt_resultados_juego enable row level security;
