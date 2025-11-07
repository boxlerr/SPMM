"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Operario } from "../_types";
import { useNotifications } from "@/contexts/NotificationContext";

interface CambiarEstadoProps {
  operario: Operario | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  cleanUrl: string;
}

export default function CambiarEstado({ operario, open, onClose, onSuccess, cleanUrl }: CambiarEstadoProps) {
  const { addNotification } = useNotifications();
  const [nuevoEstado, setNuevoEstado] = useState("");
  const [motivoCambio, setMotivoCambio] = useState("");

  useEffect(() => {
    if (operario) {
      setNuevoEstado(operario.disponible ? "Activo" : "Ausente");
      setMotivoCambio("");
    }
  }, [operario, open]);

  const handleSubmit = async () => {
    if (!operario) return;

    const estadoAnterior = operario.disponible ? "Activo" : "Ausente";
    const nuevoEstadoBoolean = nuevoEstado === "Activo";
    const estadoCambio = estadoAnterior !== nuevoEstado;

    try {
      const response = await fetch(`${cleanUrl}/operarios/${operario.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: operario.nombre,
          apellido: operario.apellido,
          sector: operario.sector,
          categoria: operario.categoria,
          fecha_nacimiento: operario.fecha_nacimiento,
          fecha_ingreso: operario.fecha_ingreso,
          disponible: nuevoEstadoBoolean,
          telefono: operario.telefono || null,
          celular: operario.celular || null,
          dni: operario.dni || null,
        }),
      });

      if (response.ok && estadoCambio) {
        addNotification(
          `Operario ${operario.nombre} ${operario.apellido} cambió de estado: ${estadoAnterior} → ${nuevoEstado}`,
          "operario_updated",
          motivoCambio.trim() || undefined
        );
      }

      onSuccess();
    } catch (err) {
      console.error("Error cambiando estado:", err);
    }
  };

  if (!operario) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Cambiar Estado - {operario.nombre} {operario.apellido}
          </DialogTitle>
          <DialogDescription>Actualizar el estado laboral del operario</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="nuevo-estado">Nuevo Estado</Label>
            <Select value={nuevoEstado} onValueChange={setNuevoEstado}>
              <SelectTrigger id="nuevo-estado">
                <SelectValue placeholder="Seleccionar estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Activo">Activo</SelectItem>
                <SelectItem value="Ausente">Ausente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo/Notas</Label>
            <Textarea
              id="motivo"
              placeholder="Describe el motivo del cambio de estado..."
              value={motivoCambio}
              onChange={(e) => setMotivoCambio(e.target.value)}
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>Confirmar Cambio</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

