-- P.07 Listado de moldes — esquema Neon (PostgreSQL)
-- Modelo: el "Nº Molde" del P.07 es la POSICIÓN física (estante, pallet, depósito, S/A);
-- la identidad del molde es su Nº Control. Se separa en dos tablas.

create table if not exists posiciones (
  codigo  text primary key,                       -- '214', '307 BIS', 'P6', 'S/A', 'Dep. PT', 'PT', 'NO'
  tipo    text not null check (tipo in ('ESTANTE','PALLET','DEPOSITO','SIN_ASIGNAR','OTRO')),
  orden   integer not null default 0,             -- orden de impresión del P.07
  activa  boolean not null default true
);

create table if not exists moldes (
  id                   serial primary key,
  n_control            text,                      -- identidad estable del molde (puede repetirse: un molde en 2 posiciones)
  especificacion       text not null,
  cliente              text,
  posicion             text references posiciones(codigo) on update cascade,
  personal_para_mover  smallint check (personal_para_mover between 1 and 9),
  estado               text,                      -- EN MAQUINA, CAMBIO, ETIQUETADOS, FALTA ETIQUETAR, ...
  actualizado_por      text not null,             -- nombre de quien hizo el último movimiento/cambio
  actualizado_ip       text,                      -- IP de ese último cambio (solo visible para admin)
  actualizado_en       timestamptz not null default now(),
  creado_en            timestamptz not null default now()
);

create index if not exists moldes_posicion_idx   on moldes (posicion);
create index if not exists moldes_n_control_idx  on moldes (n_control);
create index if not exists moldes_cliente_idx    on moldes (cliente);
