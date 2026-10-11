-- Datos editables de la ficha de producto, compartidos entre dispositivos, y su control de cambios.
-- El maestro (1.867 familias) viene en la app; acá solo se guarda lo que se edita o se agrega.
create table if not exists ficha_datos (
  familia_id      text primary key,                 -- id de la familia (F1, F2, ... / N... para altas nuevas)
  datos           jsonb not null default '{}'::jsonb,  -- campos editados (en altas nuevas, la ficha completa con _nueva: true)
  actualizado_por text not null,
  actualizado_en  timestamptz not null default now()
);

create table if not exists ficha_cambios (
  id         serial primary key,
  familia_id text not null,
  campo      text not null,
  anterior   text,
  nuevo      text,
  por        text not null,
  en         timestamptz not null default now()
);
create index if not exists ficha_cambios_familia_idx on ficha_cambios (familia_id, en desc);
