export interface ProcesoSkill {
  id_proceso: number;
  nombre_proceso?: string;
  nivel: number;
  habilitado: boolean;
}

export interface Operario {
  id: number;
  nombre: string;
  apellido: string;
  sector: string;
  categoria: string;
  disponible?: boolean;
  telefono?: string;
  celular?: string;
  dni?: string;
  fecha_nacimiento?: string;
  fecha_ingreso?: string;
  email?: string;
  skills?: ProcesoSkill[];
}

export interface Maquina {
  id: number;
  nombre: string;
  cod_maquina: string;
  limitacion?: string;
  capacidad?: string;
  especialidad?: string;
}


export interface Proceso {
  id: number;
  nombre: string;
  descripcion?: string;
}
