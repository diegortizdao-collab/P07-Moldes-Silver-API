-- Fotos de la ficha de producto (producto por variante y logo de cliente por familia).
-- Se guardan en Neon (imágenes ya achicadas por la ficha, ~100 KB c/u); se sirven por /api/fotos/:id/img.
create table if not exists fotos (
  id          uuid primary key default gen_random_uuid(),   -- cambia en cada reemplazo (rompe la caché)
  familia_id  text not null,
  variante    text not null default '',                     -- código Silver de la variante ('' para el logo)
  tipo        text not null check (tipo in ('producto','logo')),
  mime        text not null,
  datos       bytea not null,
  subido_por  text not null,
  subido_en   timestamptz not null default now(),
  unique (familia_id, variante, tipo)
);
