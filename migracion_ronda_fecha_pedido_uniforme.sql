-- Fecha de "ronda" (lote enviado al fabricante) de un pedido de uniforme.
-- Antes se agrupaban los pedidos por el día en que se cargaron al sistema
-- (created_at), pero un club puede cargar pedidos en días distintos y
-- mandarlos juntos como UN solo pedido real al proveedor — o al revés,
-- cargar varios pedidos el mismo día que van a fábrica en momentos distintos.
-- `ronda_fecha` desacopla eso: queda NULL mientras el pedido está "pendiente
-- de enviar a fábrica"; el admin la fija recién cuando arma el lote real
-- (varios pedidos a la vez, ver PUT /uniforms/asignar-ronda).
alter table public.pedido_uniformes add column if not exists ronda_fecha date;

create index if not exists idx_pedido_uniformes_ronda_fecha on public.pedido_uniformes(ronda_fecha);
