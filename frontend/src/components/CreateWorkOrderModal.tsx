"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon, Loader2 } from "lucide-react";

interface CreateWorkOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

interface Option {
    id: number;
    nombre: string;
}

export default function CreateWorkOrderModal({ isOpen, onClose, onSuccess }: CreateWorkOrderModalProps) {
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Form state
    const [formData, setFormData] = useState({
        numero_orden: "",
        fecha_inicio: "",
        fecha_fin: "",
        prioridad_id: "",
        proceso_id: "",
        operario_id: "",
    });

    // Data options
    const [prioridades, setPrioridades] = useState<Option[]>([]);
    const [procesos, setProcesos] = useState<Option[]>([]);
    const [operarios, setOperarios] = useState<{ id: number, nombre: string, apellido: string }[]>([]);

    useEffect(() => {
        if (isOpen) {
            fetchData();
        }
    }, [isOpen]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [prioridadesRes, procesosRes, operariosRes] = await Promise.all([
                fetch("http://localhost:8000/prioridades"),
                fetch("http://localhost:8000/procesos"),
                fetch("http://localhost:8000/operarios")
            ]);

            if (prioridadesRes.ok) {
                const data = await prioridadesRes.json();
                setPrioridades(Array.isArray(data) ? data : (data.data || []));
            }
            if (procesosRes.ok) {
                const data = await procesosRes.json();
                setProcesos(Array.isArray(data) ? data : (data.data || []));
            }
            if (operariosRes.ok) {
                const data = await operariosRes.json();
                setOperarios(Array.isArray(data) ? data : (data.data || []));
            }
        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            const response = await fetch("http://localhost:8000/ordenes", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    ...formData,
                    prioridad_id: parseInt(formData.prioridad_id),
                    proceso_id: parseInt(formData.proceso_id),
                    operario_id: parseInt(formData.operario_id),
                }),
            });

            if (response.ok) {
                onSuccess?.();
                onClose();
                // Reset form
                setFormData({
                    numero_orden: "",
                    fecha_inicio: "",
                    fecha_fin: "",
                    prioridad_id: "",
                    proceso_id: "",
                    operario_id: "",
                });
            } else {
                console.error("Error creating order");
            }
        } catch (error) {
            console.error("Error submitting form:", error);
        } finally {
            setSubmitting(false);
        }
    };

    const handleChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px] bg-white rounded-xl shadow-2xl border-0">
                <DialogHeader className="border-b pb-4">
                    <DialogTitle className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <div className="p-2 bg-blue-50 rounded-lg">
                            <CalendarIcon className="h-6 w-6 text-blue-600" />
                        </div>
                        Nueva Orden de Trabajo
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6 py-6">
                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="numero_orden" className="text-sm font-semibold text-gray-700">
                                Número de Orden
                            </Label>
                            <Input
                                id="numero_orden"
                                placeholder="Ej: OT-2024-001"
                                value={formData.numero_orden}
                                onChange={(e) => handleChange("numero_orden", e.target.value)}
                                className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="prioridad" className="text-sm font-semibold text-gray-700">
                                Prioridad
                            </Label>
                            <Select
                                value={formData.prioridad_id}
                                onValueChange={(value) => handleChange("prioridad_id", value)}
                                required
                            >
                                <SelectTrigger className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                                    <SelectValue placeholder="Seleccionar prioridad" />
                                </SelectTrigger>
                                <SelectContent>
                                    {prioridades.map((p) => (
                                        <SelectItem key={p.id} value={p.id.toString()}>
                                            {p.nombre}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="proceso" className="text-sm font-semibold text-gray-700">
                                Proceso
                            </Label>
                            <Select
                                value={formData.proceso_id}
                                onValueChange={(value) => handleChange("proceso_id", value)}
                                required
                            >
                                <SelectTrigger className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                                    <SelectValue placeholder="Seleccionar proceso" />
                                </SelectTrigger>
                                <SelectContent>
                                    {procesos.map((p) => (
                                        <SelectItem key={p.id} value={p.id.toString()}>
                                            {p.nombre}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="operario" className="text-sm font-semibold text-gray-700">
                                Operario
                            </Label>
                            <Select
                                value={formData.operario_id}
                                onValueChange={(value) => handleChange("operario_id", value)}
                                required
                            >
                                <SelectTrigger className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                                    <SelectValue placeholder="Seleccionar operario" />
                                </SelectTrigger>
                                <SelectContent>
                                    {operarios.map((op) => (
                                        <SelectItem key={op.id} value={op.id.toString()}>
                                            {op.nombre} {op.apellido}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="fecha_inicio" className="text-sm font-semibold text-gray-700">
                                Fecha Inicio
                            </Label>
                            <Input
                                id="fecha_inicio"
                                type="datetime-local"
                                value={formData.fecha_inicio}
                                onChange={(e) => handleChange("fecha_inicio", e.target.value)}
                                className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="fecha_fin" className="text-sm font-semibold text-gray-700">
                                Fecha Fin
                            </Label>
                            <Input
                                id="fecha_fin"
                                type="datetime-local"
                                value={formData.fecha_fin}
                                onChange={(e) => handleChange("fecha_fin", e.target.value)}
                                className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                required
                            />
                        </div>
                    </div>

                    <DialogFooter className="mt-8 pt-4 border-t">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            className="h-10 px-6 hover:bg-gray-50"
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={submitting}
                            className="h-10 px-6 bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all hover:shadow-lg"
                        >
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Crear Orden
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
