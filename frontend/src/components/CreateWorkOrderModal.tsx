"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon, Loader2, Package, User, Settings, FileText, Plus, Trash2, ArrowRight, ArrowLeft, CheckCircle2, UploadCloud, X, Image as ImageIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

interface ProcessItem {
    id: string; // Temporary ID for UI
    proceso_id: string;
    operario_id: string;
    maquinaria_id: string;
    fecha_inicio: string;
    fecha_fin: string;
}

export default function CreateWorkOrderModal({ isOpen, onClose, onSuccess }: CreateWorkOrderModalProps) {
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState("general");

    // Form state
    const [generalData, setGeneralData] = useState({
        numero_orden: "",
        cliente: "",
        descripcion: "",
        prioridad_id: "",
        fecha_prometida: "",
    });

    const [detailsData, setDetailsData] = useState({
        cantidad: "",
        material: "",
        observaciones: "",
    });

    const [processes, setProcesses] = useState<ProcessItem[]>([]);
    const [files, setFiles] = useState<File[]>([]);

    // Data options
    const [prioridades, setPrioridades] = useState<Option[]>([]);
    const [procesosOptions, setProcesosOptions] = useState<Option[]>([]);
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
                const rawData = Array.isArray(data) ? data : (data.data || []);
                setPrioridades(rawData.map((p: any) => ({ id: p.id, nombre: p.descripcion })));
            }
            if (procesosRes.ok) {
                const data = await procesosRes.json();
                setProcesosOptions(Array.isArray(data) ? data : (data.data || []));
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

    const handleAddProcess = () => {
        const newProcess: ProcessItem = {
            id: Math.random().toString(36).substr(2, 9),
            proceso_id: "",
            operario_id: "none",
            maquinaria_id: "none",
            fecha_inicio: "",
            fecha_fin: "",
        };
        setProcesses([...processes, newProcess]);
    };

    const handleRemoveProcess = (id: string) => {
        setProcesses(processes.filter(p => p.id !== id));
    };

    const handleProcessChange = (id: string, field: keyof ProcessItem, value: string) => {
        setProcesses(processes.map(p => p.id === id ? { ...p, [field]: value } : p));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        // Validation
        if (!generalData.numero_orden || !generalData.cliente || !generalData.descripcion || !generalData.prioridad_id) {
            toast.error("Por favor completa los campos obligatorios en la pestaña General");
            setSubmitting(false);
            return;
        }

        if (processes.length === 0) {
            toast.error("Debes agregar al menos un proceso");
            setSubmitting(false);
            return;
        }

        for (const p of processes) {
            if (!p.proceso_id || !p.fecha_inicio || !p.fecha_fin) {
                toast.error("Por favor completa la información de todos los procesos");
                setSubmitting(false);
                return;
            }
        }

        const fullData = {
            ...generalData,
            ...detailsData,
            procesos: processes,
            files: files.map(f => f.name), // Log file names
            cantidad: detailsData.cantidad ? parseInt(detailsData.cantidad) : undefined,
            prioridad_id: parseInt(generalData.prioridad_id),
        };

        console.log("Submitting Work Order Data (Visual Only):", fullData);

        // Mock success
        setTimeout(() => {
            toast.success("Orden de Trabajo creada correctamente (Simulación)");
            onSuccess?.();
            onClose();
            resetForm();
            setSubmitting(false);
        }, 1000);
    };

    const resetForm = () => {
        setGeneralData({
            numero_orden: "",
            cliente: "",
            descripcion: "",
            prioridad_id: "",
            fecha_prometida: "",
        });
        setDetailsData({
            cantidad: "",
            material: "",
            observaciones: "",
        });
        setProcesses([]);
        setFiles([]);
        setActiveTab("general");
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[900px] bg-white rounded-xl shadow-2xl border-0 max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
                <DialogHeader className="p-6 pb-4 border-b bg-white flex-shrink-0">
                    <DialogTitle className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/20">
                            <CalendarIcon className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex flex-col">
                            <span>Nueva Orden de Trabajo</span>
                            <span className="text-sm font-normal text-gray-500 mt-0.5">Completa la información para crear una nueva OT</span>
                        </div>
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-6">
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                            <TabsList className="grid w-full grid-cols-3 mb-8 bg-gray-100/50 p-1 rounded-xl sticky top-0 z-10 backdrop-blur-sm">
                                <TabsTrigger value="general" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-600 transition-all">
                                    <FileText size={16} className="mr-2" />
                                    1. Información General
                                </TabsTrigger>
                                <TabsTrigger value="procesos" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-600 transition-all">
                                    <Settings size={16} className="mr-2" />
                                    2. Procesos y Recursos
                                </TabsTrigger>
                                <TabsTrigger value="detalles" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-600 transition-all">
                                    <Package size={16} className="mr-2" />
                                    3. Detalles Adicionales
                                </TabsTrigger>
                            </TabsList>

                            {/* Tab: General */}
                            <TabsContent value="general" className="space-y-6 mt-0 animate-in fade-in-50 slide-in-from-left-2 duration-300">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label htmlFor="numero_orden" className="text-sm font-semibold text-gray-700">
                                            Número de Orden <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            id="numero_orden"
                                            placeholder="Ej: OT-2024-001"
                                            value={generalData.numero_orden}
                                            onChange={(e) => setGeneralData({ ...generalData, numero_orden: e.target.value })}
                                            className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 bg-gray-50/30"
                                            required
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="cliente" className="text-sm font-semibold text-gray-700">
                                            Cliente <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            id="cliente"
                                            placeholder="Nombre del cliente"
                                            value={generalData.cliente}
                                            onChange={(e) => setGeneralData({ ...generalData, cliente: e.target.value })}
                                            className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 bg-gray-50/30"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="descripcion" className="text-sm font-semibold text-gray-700">
                                        Descripción del Trabajo <span className="text-red-500">*</span>
                                    </Label>
                                    <Textarea
                                        id="descripcion"
                                        placeholder="Describe el trabajo a realizar..."
                                        value={generalData.descripcion}
                                        onChange={(e) => setGeneralData({ ...generalData, descripcion: e.target.value })}
                                        className="min-h-[100px] border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 bg-gray-50/30 resize-none"
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label htmlFor="prioridad" className="text-sm font-semibold text-gray-700">
                                            Prioridad <span className="text-red-500">*</span>
                                        </Label>
                                        <Select
                                            value={generalData.prioridad_id}
                                            onValueChange={(value) => setGeneralData({ ...generalData, prioridad_id: value })}
                                            required
                                        >
                                            <SelectTrigger className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 bg-gray-50/30">
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
                                        <Label htmlFor="fecha_prometida" className="text-sm font-semibold text-gray-700">
                                            Fecha Prometida
                                        </Label>
                                        <Input
                                            id="fecha_prometida"
                                            type="datetime-local"
                                            value={generalData.fecha_prometida}
                                            onChange={(e) => setGeneralData({ ...generalData, fecha_prometida: e.target.value })}
                                            className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 bg-gray-50/30"
                                        />
                                    </div>
                                </div>
                            </TabsContent>

                            {/* Tab: Procesos */}
                            <TabsContent value="procesos" className="space-y-6 mt-0 animate-in fade-in-50 slide-in-from-right-2 duration-300">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="space-y-1">
                                        <h3 className="text-lg font-semibold text-gray-900">Procesos de la Orden</h3>
                                        <p className="text-sm text-gray-500">Define la secuencia de procesos para esta orden</p>
                                    </div>
                                    <Button
                                        type="button"
                                        onClick={handleAddProcess}
                                        className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 shadow-sm"
                                    >
                                        <Plus className="w-4 h-4 mr-2" />
                                        Agregar Proceso
                                    </Button>
                                </div>

                                <div className="space-y-4">
                                    {processes.length === 0 ? (
                                        <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                                            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                                <Settings className="w-6 h-6 text-gray-400" />
                                            </div>
                                            <p className="text-gray-500 font-medium">No hay procesos agregados</p>
                                            <p className="text-sm text-gray-400 mt-1">Haz clic en "Agregar Proceso" para comenzar</p>
                                        </div>
                                    ) : (
                                        processes.map((process, index) => (
                                            <Card key={process.id} className="border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 group">
                                                <CardContent className="p-5">
                                                    <div className="flex items-center justify-between mb-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                                                                {index + 1}
                                                            </div>
                                                            <h4 className="font-semibold text-gray-900">Proceso #{index + 1}</h4>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleRemoveProcess(process.id)}
                                                            className="text-gray-400 hover:text-red-500 hover:bg-red-50"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>

                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-medium text-gray-500">Tipo de Proceso *</Label>
                                                            <Select
                                                                value={process.proceso_id}
                                                                onValueChange={(value) => handleProcessChange(process.id, "proceso_id", value)}
                                                            >
                                                                <SelectTrigger className="h-9">
                                                                    <SelectValue placeholder="Seleccionar..." />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {procesosOptions.map((p) => (
                                                                        <SelectItem key={p.id} value={p.id.toString()}>
                                                                            {p.nombre}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>

                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-medium text-gray-500">Operario</Label>
                                                            <Select
                                                                value={process.operario_id}
                                                                onValueChange={(value) => handleProcessChange(process.id, "operario_id", value)}
                                                            >
                                                                <SelectTrigger className="h-9">
                                                                    <SelectValue placeholder="Opcional" />
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

                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-medium text-gray-500">Maquinaria</Label>
                                                            <Select
                                                                value={process.maquinaria_id}
                                                                onValueChange={(value) => handleProcessChange(process.id, "maquinaria_id", value)}
                                                            >
                                                                <SelectTrigger className="h-9">
                                                                    <SelectValue placeholder="Opcional" />
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

                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-medium text-gray-500">Inicio Estimado *</Label>
                                                            <Input
                                                                type="datetime-local"
                                                                value={process.fecha_inicio}
                                                                onChange={(e) => handleProcessChange(process.id, "fecha_inicio", e.target.value)}
                                                                className="h-9"
                                                            />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-medium text-gray-500">Fin Estimado *</Label>
                                                            <Input
                                                                type="datetime-local"
                                                                value={process.fecha_fin}
                                                                onChange={(e) => handleProcessChange(process.id, "fecha_fin", e.target.value)}
                                                                className="h-9"
                                                            />
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))
                                    )}
                                </div>
                            </TabsContent>

                            {/* Tab: Detalles */}
                            <TabsContent value="detalles" className="space-y-6 mt-0 animate-in fade-in-50 slide-in-from-right-2 duration-300">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label htmlFor="cantidad" className="text-sm font-semibold text-gray-700">
                                            Cantidad
                                        </Label>
                                        <Input
                                            id="cantidad"
                                            type="number"
                                            placeholder="Ej: 100"
                                            value={detailsData.cantidad}
                                            onChange={(e) => setDetailsData({ ...detailsData, cantidad: e.target.value })}
                                            className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 bg-gray-50/30"
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
                                            value={detailsData.material}
                                            onChange={(e) => setDetailsData({ ...detailsData, material: e.target.value })}
                                            className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 bg-gray-50/30"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700">
                                        Archivos Adjuntos (Planos, Especificaciones)
                                    </Label>
                                    <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 transition-all hover:border-blue-400 hover:bg-blue-50/30 group text-center cursor-pointer relative">
                                        <input
                                            type="file"
                                            multiple
                                            accept="image/*,.pdf"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                            onChange={(e) => {
                                                if (e.target.files) {
                                                    const newFiles = Array.from(e.target.files);
                                                    setFiles(prev => [...prev, ...newFiles]);
                                                }
                                            }}
                                        />
                                        <div className="flex flex-col items-center gap-2 pointer-events-none">
                                            <div className="p-3 bg-blue-50 text-blue-600 rounded-full group-hover:scale-110 transition-transform">
                                                <UploadCloud className="w-6 h-6" />
                                            </div>
                                            <div className="text-sm text-gray-600">
                                                <span className="font-semibold text-blue-600">Haz clic para subir</span> o arrastra y suelta
                                            </div>
                                            <p className="text-xs text-gray-400">PDF, PNG, JPG (máx. 10MB)</p>
                                        </div>
                                    </div>

                                    {files.length > 0 && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                            {files.map((file, index) => (
                                                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded-lg group hover:border-blue-200 transition-all">
                                                    <div className="flex items-center gap-3 overflow-hidden">
                                                        <div className="p-2 bg-white rounded-md border border-gray-100 text-gray-500">
                                                            {file.type.includes('pdf') ? (
                                                                <FileText className="w-4 h-4 text-red-500" />
                                                            ) : (
                                                                <ImageIcon className="w-4 h-4 text-blue-500" />
                                                            )}
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-sm font-medium text-gray-700 truncate">{file.name}</span>
                                                            <span className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setFiles(files.filter((_, i) => i !== index))}
                                                        className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="observaciones" className="text-sm font-semibold text-gray-700">
                                        Observaciones / Notas Adicionales
                                    </Label>
                                    <Textarea
                                        id="observaciones"
                                        placeholder="Agrega cualquier nota o comentario adicional..."
                                        value={detailsData.observaciones}
                                        onChange={(e) => setDetailsData({ ...detailsData, observaciones: e.target.value })}
                                        className="min-h-[100px] border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 bg-gray-50/30 resize-none"
                                    />
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>

                    <DialogFooter className="p-6 border-t bg-gray-50/50 flex-shrink-0">
                        <div className="flex items-center justify-between w-full">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleClose}
                                className="h-11 px-8 hover:bg-white hover:text-red-600 hover:border-red-200 transition-colors"
                            >
                                Cancelar
                            </Button>
                            <div className="flex gap-3">
                                {activeTab !== "general" && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setActiveTab(activeTab === "detalles" ? "procesos" : "general")}
                                        className="h-11 px-6"
                                    >
                                        <ArrowLeft className="w-4 h-4 mr-2" />
                                        Anterior
                                    </Button>
                                )}
                                {activeTab !== "detalles" ? (
                                    <Button
                                        type="button"
                                        onClick={() => setActiveTab(activeTab === "general" ? "procesos" : "detalles")}
                                        className="h-11 px-6 bg-gray-900 text-white hover:bg-gray-800"
                                    >
                                        Siguiente
                                        <ArrowRight className="w-4 h-4 ml-2" />
                                    </Button>
                                ) : (
                                    <Button
                                        type="submit"
                                        disabled={submitting || loading}
                                        className="h-11 px-8 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.02]"
                                    >
                                        {submitting ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <CheckCircle2 className="mr-2 h-4 w-4" />
                                        )}
                                        Crear Orden
                                    </Button>
                                )}
                            </div>
                        </div>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
