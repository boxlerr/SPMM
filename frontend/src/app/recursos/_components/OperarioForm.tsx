"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Operario } from "../_types";

interface OperarioFormProps {
  open: boolean;
  editing: boolean;
  data: Operario | null;
  onClose: () => void;
  onSuccess: () => void;
  cleanUrl: string;
}

export default function OperarioForm({ open, editing, data, onClose, onSuccess, cleanUrl }: OperarioFormProps) {
  const [formData, setFormData] = useState({
    nombre: "",
    apellido: "",
    sector: "",
    categoria: "",
    fecha_nacimiento: "",
    fecha_ingreso: "",
    telefono: "",
    celular: "",
    dni: "",
  });

  useEffect(() => {
    if (data) {
      setFormData({
        nombre: data.nombre || "",
        apellido: data.apellido || "",
        sector: data.sector || "",
        categoria: data.categoria || "",
        fecha_nacimiento: data.fecha_nacimiento || "",
        fecha_ingreso: data.fecha_ingreso || "",
        telefono: data.telefono || "",
        celular: data.celular || "",
        dni: data.dni || "",
      });
    } else {
      setFormData({
        nombre: "",
        apellido: "",
        sector: "",
        categoria: "",
        fecha_nacimiento: "",
        fecha_ingreso: "",
        telefono: "",
        celular: "",
        dni: "",
      });
    }
  }, [data, open]);

  const handleSubmit = async () => {
    if (editing && data) {
      await fetch(`${cleanUrl}/operarios/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          disponible: data.disponible ?? true,
          telefono: formData.telefono || null,
          celular: formData.celular || null,
          dni: formData.dni || null,
        }),
      });
    } else {
      await fetch(`${cleanUrl}/operarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          disponible: true,
          telefono: formData.telefono || null,
          celular: formData.celular || null,
          dni: formData.dni || null,
        }),
      });
    }
    onSuccess();
  };

  const disabled = !formData.nombre || !formData.apellido || !formData.sector || !formData.categoria || !formData.fecha_nacimiento || !formData.fecha_ingreso;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Crear"} Operario</DialogTitle>
          <DialogDescription>{editing ? "Modifica" : "Completa"} los datos del operario</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Información Personal</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Juan" />
              </div>
              <div className="space-y-2">
                <Label>Apellido *</Label>
                <Input value={formData.apellido} onChange={(e) => setFormData({ ...formData, apellido: e.target.value })} placeholder="Pérez" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>DNI</Label>
                <Input value={formData.dni} onChange={(e) => setFormData({ ...formData, dni: e.target.value })} placeholder="12345678" />
              </div>
              <div className="space-y-2">
                <Label>Fecha de Nacimiento *</Label>
                <Input type="date" value={formData.fecha_nacimiento} onChange={(e) => setFormData({ ...formData, fecha_nacimiento: e.target.value })} required />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Información Laboral</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sector *</Label>
                <Input value={formData.sector} onChange={(e) => setFormData({ ...formData, sector: e.target.value })} placeholder="MECANIZADO" />
              </div>
              <div className="space-y-2">
                <Label>Categoría *</Label>
                <Input value={formData.categoria} onChange={(e) => setFormData({ ...formData, categoria: e.target.value })} placeholder="OPERARIO CALIFICADO" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fecha de Ingreso *</Label>
              <Input type="date" value={formData.fecha_ingreso} onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })} required />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Información de Contacto</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input value={formData.telefono} onChange={(e) => setFormData({ ...formData, telefono: e.target.value })} placeholder="4233-2492" />
              </div>
              <div className="space-y-2">
                <Label>Celular</Label>
                <Input value={formData.celular} onChange={(e) => setFormData({ ...formData, celular: e.target.value })} placeholder="11-2748-6366" />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={disabled}>{editing ? "Guardar Cambios" : "Crear Operario"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

