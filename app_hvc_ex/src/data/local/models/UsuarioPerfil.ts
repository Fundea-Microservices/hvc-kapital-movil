import { Model } from '@nozbe/watermelondb';
import { field, date } from '@nozbe/watermelondb/decorators';

export default class UsuarioPerfil extends Model {
  static table = 'usuario_perfil';

  @field('id_usuario') id_usuario!: number;
  @field('usuario_guid') usuario_guid!: string | null;
  @field('nombre') nombre!: string;
  @field('usuario') usuario!: string | null;
  @field('foto_url') foto_url!: string | null;
  @field('rol') rol!: string;
  @field('permisos_json') permisos_json!: string;
  @date('ultimo_login') ultimo_login!: Date;
}