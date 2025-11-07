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
}

export interface Maquina {
  id: number;
  nombre: string;
  cod_maquina: string;
  limitacion?: string;
  capacidad?: string;
  especialidad?: string;
}

