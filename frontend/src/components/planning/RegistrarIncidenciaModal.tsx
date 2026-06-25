"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileWarning } from "lucide-react";
import { toast } from "sonner";
import { API_URL } from "@/config";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

interface RegistrarIncidenciaModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    orderId: number;
    procesoId?: number | null;
    procesoNombre?: string;
    operarioId?: number | null;
    operarioNombre?: string;
}

export function RegistrarIncidenciaModal({
    open,
    onClose,
    onSuccess,
    orderId,
    procesoId,
    procesoNombre,
    operarioId,
    operarioNombre,
}: RegistrarIncidenciaModalProps) {
    const [minutos, setMinutos] = React.useState("");
    const [operariosExtra, setOperariosExtra] = React.useState("");
    const [descripcion, setDescripcion] = React.useState("");
    const [loading, setLoading] = React.useState(false);

    // Reset al abrir
    React.useEffect(() => {
        if (open) {
            setMinutos("");
            setOperariosExtra("");
            setDescripcion("");
        }
    }, [open]);

    const handleSave = async () => {
        const min = parseInt(minutos) || 0;
        if (min <= 0 && !descripcion.trim()) {
            toast.error("Cargá los minutos perdidos o una descripción.");
            return;
        }
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/incidencias`, {
                method: "POST",
                headers: { ...(getAuthHeaders() as Record<string, string>), "Content-Type": "application/json" },
                body: JSON.stringify({
                    id_orden_trabajo: orderId,
                    id_proceso: procesoId ?? null,
                    id_operario: operarioId ?? null,
                    tipo: "INTERPRETACION_PLANOS",
                    minutos_perdidos: min,
                    operarios_extra: parseInt(operariosExtra) || 0,
                    descripcion: descripcion.trim() || null,
                }),
            });
            if (!res.ok) throw new Error("save failed");
            toast.success("Incidencia registrada");
            onSuccess?.();
            onClose();
        } catch (e) {
            console.error(e);
            toast.error("No se pudo registrar la incidencia");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileWarning className="w-5 h-5 text-amber-600" />
                        Registrar incidencia de plano
                    </DialogTitle>
                    <DialogDescription>
                        Registrá cuándo se perdió tiempo o hizo falta más gente porque no se interpretó un plano.
                        {procesoNombre ? ` Proceso: ${procesoNombre}.` : ""}
                        {operarioNombre ? ` Operario: ${operarioNombre}.` : ""}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4 py-2">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-gray-600">Minutos perdidos</Label>
                        <Input
                            type="number"
                            min={0}
                            placeholder="Ej: 30"
                            value={minutos}
                            onChange={(e) => setMinutos(e.target.value)}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-gray-600">Operarios extra que hicieron falta</Label>
                        <Input
                            type="number"
                            min={0}
                            placeholder="Ej: 1"
                            value={operariosExtra}
                            onChange={(e) => setOperariosExtra(e.target.value)}
                        />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-gray-600">Descripción (opcional)</Label>
                    <Textarea
                        placeholder="Qué pasó, qué plano, etc."
                        value={descripcion}
                        onChange={(e) => setDescripcion(e.target.value)}
                        rows={3}
                    />
                </div>

                <DialogFooter className="mt-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button type="button" onClick={handleSave} disabled={loading} className="bg-amber-600 hover:bg-amber-700 text-white">
                        {loading ? "Guardando..." : "Registrar"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
