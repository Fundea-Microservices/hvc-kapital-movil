/**
 * Doble del adaptador SQLite de WatermelonDB.
 *
 * Es la ÚNICA pieza nativa que impide que la capa de datos se cargue en Node: el resto
 * de WatermelonDB (el constructor de consultas `Q`, `Database`, `Model`, los
 * decoradores) es JavaScript plano y corre tal cual, así que se usa el paquete REAL.
 *
 * Sustituir solo el adaptador —y no la librería entera— evita el riesgo de que las
 * pruebas terminen verificando un doble que se desalineó de la implementación.
 */
class SQLiteAdapterFalso {
  constructor(opciones) {
    this.opciones = opciones;
    this.schema = opciones?.schema;
  }
}

module.exports = SQLiteAdapterFalso;
module.exports.default = SQLiteAdapterFalso;
