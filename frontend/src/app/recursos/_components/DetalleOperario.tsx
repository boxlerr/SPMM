"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { User, Phone, Activity } from "lucide-react";
import { Operario } from "../_types";

interface DetalleOperarioProps {
  operario: Operario | null;
  onClose: () => void;
  onCambiarEstado: (operario: Operario) => void;
}

export default function DetalleOperario({ operario, onClose, onCambiarEstado }: DetalleOperarioProps) {
  if (!operario) return null;

  const getEstadoColor = (disponible?: boolean) => {
    return disponible
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  };

  return (
    <Dialog open={!!operario} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Perfil del Operario</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold">
                {operario.nombre} {operario.apellido}
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
                <span>{operario.dni}</span>
              </div>
            )}

            {(operario.telefono || operario.celular) && (
              <div>
                <p className="font-medium mb-1">Contacto:</p>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{operario.celular || operario.telefono}</span>
                </div>
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
    </Dialog>
  );
}

