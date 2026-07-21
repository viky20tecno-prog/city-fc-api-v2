-- Marca si un pedido de uniforme se cobró a precio de proveedor (costo, sin
-- margen) en vez del precio al público del catálogo — caso típico: personal
-- de staff/cuerpo técnico, a quien el club no le cobra el margen normal.
-- Puramente informativo/de auditoría: el monto real ya se calcula y guarda
-- en total/precio_unitario al momento de crear el pedido: esta columna solo
-- permite mostrarlo distinto en pantalla y filtrar hacia adelante.
alter table public.pedido_uniformes add column if not exists a_precio_proveedor boolean not null default false;
