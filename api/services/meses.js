const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function mesTexto(numero_mes) {
  return MESES[numero_mes] ?? 'Mes';
}

module.exports = { MESES, mesTexto };
