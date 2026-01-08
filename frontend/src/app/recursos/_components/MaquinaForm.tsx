"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Maquina } from "../_types";
import { useToast } from "@/components/ui/toast"

const getAuthHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};;

interface MaquinaFormProps {
  open: boolean;
  editing: boolean;
  data: Maquina | null;
  onClose: () => void;
  onSuccess: () => void;
  cleanUrl: string;
}

export default function MaquinaForm({ open, editing, data, onClose, onSuccess, cleanUrl }: MaquinaFormProps) {
  const { showToast } = useToast();
  const [formData, setFormData] = useState({
    nombre: "",
    cod_maquina: "",
    limitacion: "",
    capacidad: "",
    especialidad: "",
  });

  useEffect(() => {
    if (data) {
      setFormData({
        nombre: data.nombre || "",
        cod_maquina: data.cod_maquina || "",
        limitacion: data.limitacion || "",
        capacidad: data.capacidad || "",
        especialidad: data.especialidad || "",
      });
    } else {
      setFormData({
        nombre: "",
        cod_maquina: "",
        limitacion: "",
        capacidad: "",
        especialidad: "",
      });
    }
  }, [data, open]);

  const handleSubmit = async () => {
    const payload = {
      nombre: formData.nombre,
      cod_maquina: formData.cod_maquina || null,
      limitacion: formData.limitacion || null,
      capacidad: formData.capacidad || null,
      especialidad: formData.especialidad || null,
    };

    if (editing && data) {
      const response = await fetch(`${cleanUrl}/maquinarias/${data.id}`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        showToast(`Máquina '${payload.nombre}' modificada correctamente`, 'success');
      }
    } else {
      const response = await fetch(`${cleanUrl}/maquinarias`, {
        method: "POST",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        showToast(`Máquina '${payload.nombre}' creada correctamente`, 'success');
      }
    }
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Crear"} Maquinaria</DialogTitle>
          <DialogDescription>{editing ? "Modifica" : "Completa"} los datos de la maquinaria</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Nombre *</Label>
            <Input value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Torno CNC Haas VF2" />
          </div>
          <div className="space-y-2">
            <Label>Código</Label>
            <Input value={formData.cod_maquina} onChange={(e) => setFormData({ ...formData, cod_maquina: e.target.value })} placeholder="TORNO-01" />
          </div>


          <div className="space-y-2">
            <Label>Limitación</Label>
            <Input value={formData.limitacion} onChange={(e) => setFormData({ ...formData, limitacion: e.target.value })} placeholder="Falla en avance automático" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!formData.nombre}>{editing ? "Guardar Cambios" : "Crear Maquinaria"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

