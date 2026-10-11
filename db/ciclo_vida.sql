-- Ciclo de vida del molde (semáforo): ACTIVO / EN_REPARACION / INACTIVO / BAJA.
-- Independiente de "estado" (que describe dónde está / qué trámite tiene). NULL = sin clasificar.
-- Idempotente: se puede correr más de una vez.
alter table moldes add column if not exists ciclo_vida text
  check (ciclo_vida in ('ACTIVO','EN_REPARACION','INACTIVO','BAJA'));
alter table moldes add column if not exists ciclo_vida_origen text
  check (ciclo_vida_origen in ('sugerido','confirmado'));
alter table moldes add column if not exists ciclo_vida_por text;
alter table moldes add column if not exists ciclo_vida_en timestamptz;

-- Propuesta inicial (solo donde todavía no hay clasificación). Queda como "sugerido" hasta que el admin confirme.
update moldes set ciclo_vida = 'EN_REPARACION', ciclo_vida_origen = 'sugerido'
  where ciclo_vida is null and estado = 'EN REPARACION ESTANTERIA ROJA';
update moldes set ciclo_vida = 'ACTIVO', ciclo_vida_origen = 'sugerido'
  where ciclo_vida is null and estado in ('EN MAQUINA','CAMBIO');
