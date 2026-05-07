import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from './schema';
import MetadataSync from './models/MetadataSync';
import CatParametros from './models/CatParametros';
import UsuarioPerfil from './models/UsuarioPerfil';
import CatMenu from './models/CatMenu';
import LocalEncuesta from './models/LocalEncuesta';
import LocalSeccion from './models/LocalSeccion';
import LocalEstructuraPregunta from './models/LocalEstructuraPregunta';
import LocalCaptura from './models/LocalCaptura';
import LocalCatalogo from './models/LocalCatalogo';
import { migrations } from './migrations';

// 1. Configurar el adaptador para SQLite
const adapter = new SQLiteAdapter({
  schema,
  // (Opcional) Migraciones: las configuraremos en el futuro si el esquema cambia
  //migrations,
  jsi: false, // Habilita JSI para un rendimiento 2x-3x más rápido en Android/iOS
  onSetUpError: error => {
    console.error('Error al configurar la base de datos local:', error);
  }
});

// 2. Crear la instancia de la base de datos
export const database = new Database({
  adapter,
  modelClasses: [
    MetadataSync,
    CatParametros,
    UsuarioPerfil,
    CatMenu,
    LocalEncuesta,
    LocalSeccion,
    LocalEstructuraPregunta,
    LocalCaptura,
    LocalCatalogo,
  ],
});