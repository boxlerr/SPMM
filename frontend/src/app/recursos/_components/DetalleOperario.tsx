"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { User, Phone, Activity, Calendar, FileText } from "lucide-react";
import { Operario } from "../_types";
import { PlanificacionItem } from "@/lib/types";

interface DetalleOperarioProps {
  operario: Operario | null;
  tasks?: PlanificacionItem[];
  onClose: () => void;
  onCambiarEstado: (operario: Operario) => void;
}

export default function DetalleOperario({ operario, tasks = [], onClose, onCambiarEstado }: DetalleOperarioProps) {
  if (!operario) return null;

  const capitalizeName = (text?: string) => {
    if (!text) return "";
    return text
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const getEstadoColor = (disponible?: boolean) => {
    return disponible
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr || dateStr.startsWith('1950')) return "-";
    try {
      const date = new Date(dateStr);
      return new Intl.DateTimeFormat('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).format(date);
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <Dialog open={!!operario} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Perfil del Operario</DialogTitle>
          <DialogDescription>Información detallada del operario</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold">
                {capitalizeName(operario.nombre)} {capitalizeName(operario.apellido)}
              </h3>
              <p className="text-muted-foreground">ID: {operario.id}</p>
            </div>
            <Badge className={getEstadoColor(operario.disponible)}>
              {operario.disponible ? "Activo" : "Ausente"}
            </Badge>
          </div>

          <div className="grid gap-4">
            <div>
              <p className="font-medium mb-2">Sector:</p>
              <Badge variant="secondary">{operario.sector}</Badge>
            </div>

            <div>
              <p className="font-medium mb-2">Categoría:</p>
              <Badge variant="secondary">{operario.categoria}</Badge>
            </div>

            {operario.dni && (
              <div>
                <p className="font-medium mb-1">DNI:</p>
                <span>{(operario.dni || "").replace(/\./g, "")}</span>
              </div>
            )}

            {(operario.telefono || operario.celular) && (
              <div>
                <p className="font-medium mb-1">Contacto:</p>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{(operario.celular || operario.telefono || "").replace(/\D/g, "")}</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Órdenes de Trabajo Asignadas
            </h4>

            {tasks.length === 0 ? (
              <div className="text-center py-6 bg-gray-50 rounded-lg text-muted-foreground text-sm">
                No hay tareas asignadas actualmente.
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">OT</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Proceso</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Fechas</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tasks.map((task, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">#{task.orden_id}</td>
                        <td className="px-4 py-2">
                          <div className="flex flex-col">
                            <span className="font-medium">{task.nombre_proceso}</span>
                            <span className="text-xs text-gray-500">{task.descripcion_articulo}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs">
                          <div><span className="text-gray-400">In:</span> {formatDate(new Date(task.inicio_min * 60 * 1000 + new Date().setHours(0, 0, 0, 0)).toISOString())}</div> {/* Mock date calc */}
                          <div><span className="text-gray-400">Fin:</span> {formatDate(task.fecha_prometida)}</div>
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className={
                            task.id_estado === 3 ? "bg-green-50 text-green-700 border-green-200" :
                              task.id_estado === 2 ? "bg-blue-50 text-blue-700 border-blue-200" :
                                "bg-gray-50 text-gray-600 border-gray-200"
                          }>
                            {task.estado}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              onCambiarEstado(operario);
              onClose();
            }}
            className="gap-2"
          >
            <Activity className="h-4 w-4" />
            Cambiar Estado
          </Button>
          <Button onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog >
  );
}

