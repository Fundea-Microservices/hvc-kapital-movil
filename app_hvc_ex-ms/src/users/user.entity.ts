import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('Usuarios_AppEx') // Mapearemos esto a una tabla llamada "Usuarios" en SQL Server
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  username: string;

  @Column({ type: 'varchar', length: 100 })
  nombrecompleto: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash: string; // Nunca guardamos contraseñas en texto plano

  @Column({ type: 'bit', default: 1 })
  estado: boolean; // 1 = Activo, 0 = Inactivo (Para cumplir la validación de Login)

  @CreateDateColumn()
  fechaCreacion: Date;
}
