"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon, Loader2, Package, User, Settings, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CreateWorkOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

interface Option {
    id: number;
    nombre: string;
}

interface Maquina {
    id: number;
    nombre: string;
}

export default function CreateWorkOrderModal({ isOpen, onClose, onSuccess }: CreateWorkOrderModalProps) {
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState("general");

    // Form state
    const [formData, setFormData] = useState({
        numero_orden: "",
        cliente: "",
        descripcion: "",
        cantidad: "",
        material: "",
        fecha_inicio: "",
        fecha_fin: "",
        fecha_prometida: "",
        prioridad_id: "",
        proceso_id: "",
        operario_id: "",
        maquinaria_id: "",
        observaciones: "",
    });

    // Data options
    const [prioridades, setPrioridades] = useState<Option[]>([]);
    const [procesos, setProcesos] = useState<Option[]>([]);
    const [operarios, setOperarios] = useState<{ id: number, nombre: string, apellido: string }[]>([]);
    const [maquinarias, setMaquinarias] = useState<Maquina[]>([]);

    useEffect(() => {
        if (isOpen) {
            fetchData();
        }
    }, [isOpen]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [prioridadesRes, procesosRes, operariosRes, maquinariasRes] = await Promise.all([
                fetch("http://localhost:8000/prioridades"),
                fetch("http://localhost:8000/procesos"),
                fetch("http://localhost:8000/operarios"),
                fetch("http://localhost:8000/maquinarias")
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
            if (maquinariasRes.ok) {
                const data = await maquinariasRes.json();
                setMaquinarias(Array.isArray(data) ? data : (data.data || []));
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
                    cantidad: formData.cantidad ? parseInt(formData.cantidad) : undefined,
                    prioridad_id: parseInt(formData.prioridad_id),
                    proceso_id: parseInt(formData.proceso_id),
                    operario_id: formData.operario_id ? parseInt(formData.operario_id) : undefined,
                    maquinaria_id: formData.maquinaria_id ? parseInt(formData.maquinaria_id) : undefined,
                }),
            });

            if (response.ok) {
                onSuccess?.();
                onClose();
                resetForm();
            } else {
                console.error("Error creating order");
            }
        } catch (error) {
            console.error("Error submitting form:", error);
        } finally {
            setSubmitting(false);
        }
    };

    const resetForm = () => {
        setFormData({
            numero_orden: "",
            cliente: "",
            descripcion: "",
            cantidad: "",
            material: "",
            fecha_inicio: "",
            fecha_fin: "",
            fecha_prometida: "",
            prioridad_id: "",
            proceso_id: "",
            operario_id: "",
            maquinaria_id: "",
            observaciones: "",
        });
        setActiveTab("general");
    };

    const handleChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[800px] bg-white rounded-xl shadow-2xl border-0 max-h-[90vh] overflow-y-auto">
                <DialogHeader className="border-b pb-4 sticky top-0 bg-white z-10">
                    <DialogTitle className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <div className="p-2 bg-blue-50 rounded-lg">
                            <CalendarIcon className="h-6 w-6 text-blue-600" />
                        </div>
                        Nueva Orden de Trabajo
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6 py-4">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-3 mb-6">
                            <TabsTrigger value="general" className="flex items-center gap-2">
                                <FileText size={16} />
                                General
                            </TabsTrigger>
                            <TabsTrigger value="recursos" className="flex items-center gap-2">
                                <Settings size={16} />
                                Recursos
                            </TabsTrigger>
                            <TabsTrigger value="detalles" className="flex items-center gap-2">
                                <Package size={16} />
                                Detalles
                            </TabsTrigger>
                        </TabsList>

                        {/* Tab: General */}
                        <TabsContent value="general" className="space-y-4 mt-0">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="numero_orden" className="text-sm font-semibold text-gray-700">
                                        Número de Orden *
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
                                    <Label htmlFor="cliente" className="text-sm font-semibold text-gray-700">
                                        Cliente *
                                    </Label>
                                    <Input
                                        id="cliente"
                                        placeholder="Nombre del cliente"
                                        value={formData.cliente}
                                        onChange={(e) => handleChange("cliente", e.target.value)}
                                        className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="descripcion" className="text-sm font-semibold text-gray-700">
                                    Descripción del Trabajo *
                                </Label>
                                <Textarea
                                    id="descripcion"
                                    placeholder="Describe el trabajo a realizar..."
                                    value={formData.descripcion}
                                    onChange={(e) => handleChange("descripcion", e.target.value)}
                                    className="min-h-[80px] border-gray-300 focus:border-blue-500 focus:ring-blue-500 resize-none"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="prioridad" className="text-sm font-semibold text-gray-700">
                                        Prioridad *
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

                                <div className="space-y-2">
                                    <Label htmlFor="proceso" className="text-sm font-semibold text-gray-700">
                                        Proceso *
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
                            </div>
                        </TabsContent>

                        {/* Tab: Recursos */}
                        <TabsContent value="recursos" className="space-y-4 mt-0">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="operario" className="text-sm font-semibold text-gray-700">
                                        Operario Asignado
                                    </Label>
                                    <Select
                                        value={formData.operario_id}
                                        onValueChange={(value) => handleChange("operario_id", value)}
                                    >
                                        <SelectTrigger className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                                            <SelectValue placeholder="Seleccionar operario" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Sin asignar</SelectItem>
                                            {operarios.map((op) => (
                                                <SelectItem key={op.id} value={op.id.toString()}>
                                                    {op.nombre} {op.apellido}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="maquinaria" className="text-sm font-semibold text-gray-700">
                                        Maquinaria Asignada
                                    </Label>
                                    <Select
                                        value={formData.maquinaria_id}
                                        onValueChange={(value) => handleChange("maquinaria_id", value)}
                                    >
                                        <SelectTrigger className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                                            <SelectValue placeholder="Seleccionar maquinaria" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Sin asignar</SelectItem>
                                            {maquinarias.map((m) => (
                                                <SelectItem key={m.id} value={m.id.toString()}>
                                                    {m.nombre}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="fecha_inicio" className="text-sm font-semibold text-gray-700">
                                        Fecha Inicio *
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
                                        Fecha Fin *
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

                                <div className="space-y-2">
                                    <Label htmlFor="fecha_prometida" className="text-sm font-semibold text-gray-700">
                                        Fecha Prometida
                                    </Label>
                                    <Input
                                        id="fecha_prometida"
                                        type="datetime-local"
                                        value={formData.fecha_prometida}
                                        onChange={(e) => handleChange("fecha_prometida", e.target.value)}
                                        className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        </TabsContent>

                        {/* Tab: Detalles */}
                        <TabsContent value="detalles" className="space-y-4 mt-0">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="cantidad" className="text-sm font-semibold text-gray-700">
                                        Cantidad
                                    </Label>
                                    <Input
                                        id="cantidad"
                                        type="number"
                                        placeholder="Ej: 100"
                                        value={formData.cantidad}
                                        onChange={(e) => handleChange("cantidad", e.target.value)}
                                        className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                        min="1"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="material" className="text-sm font-semibold text-gray-700">
                                        Material
                                    </Label>
                                    <Input
                                        id="material"
                                        placeholder="Ej: Acero inoxidable"
                                        value={formData.material}
                                        onChange={(e) => handleChange("material", e.target.value)}
                                        className="h-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="observaciones" className="text-sm font-semibold text-gray-700">
                                    Observaciones / Notas Adicionales
                                </Label>
                                <Textarea
                                    id="observaciones"
                                    placeholder="Agrega cualquier nota o comentario adicional..."
                                    value={formData.observaciones}
                                    onChange={(e) => handleChange("observaciones", e.target.value)}
                                    className="min-h-[120px] border-gray-300 focus:border-blue-500 focus:ring-blue-500 resize-none"
                                />
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <p className="text-sm text-blue-800">
                                    <strong>Nota:</strong> Los campos marcados con (*) son obligatorios. Asegúrate de completar toda la información necesaria antes de crear la orden.
                                </p>
                            </div>
                        </TabsContent>
                    </Tabs>

                    <DialogFooter className="mt-6 pt-4 border-t sticky bottom-0 bg-white">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleClose}
                            className="h-10 px-6 hover:bg-gray-50"
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={submitting || loading}
                            className="h-10 px-6 bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all hover:shadow-lg"
                        >
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Crear Orden de Trabajo
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
