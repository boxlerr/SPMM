import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_URL } from "@/config";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface RegisterDeliveryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentOrder: {
        id: number;
        total: number;
        delivered: number;
    } | null;
    onSuccess: () => void;
}

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export function RegisterDeliveryDialog({ open, onOpenChange, currentOrder, onSuccess }: RegisterDeliveryDialogProps) {
    const [amountToAdd, setAmountToAdd] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!currentOrder) return null;

    const handleSave = async () => {
        const val = parseInt(amountToAdd);
        if (isNaN(val) || val <= 0) {
            toast.error("Ingresa una cantidad válida mayor a 0");
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch(`${API_URL}/ordenes/${currentOrder.id}/entrega`, {
                method: 'PUT',
                headers: {
                    ...getAuthHeaders() as Record<string, string>,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cantidad_agregar: val
                })
            });

            if (!response.ok) throw new Error("Error al registrar entrega");

            toast.success("Entrega registrada correctamente");
            setAmountToAdd(""); // Reset
            onSuccess();
            onOpenChange(false);
        } catch (error) {
            console.error(error);
            toast.error("Hubo un error al guardar la entrega");
        } finally {
            setIsSubmitting(false);
        }
    };

    const currentDelivered = currentOrder.delivered || 0;
    const total = currentOrder.total || 0;
    const adding = parseInt(amountToAdd) || 0;
    const newTotal = currentDelivered + adding;
    const remaining = Math.max(0, total - newTotal);
    const isExceeding = newTotal > total;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Registrar Entrega Parcial</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex items-center justify-between text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
                        <div className="flex flex-col">
                            <span className="font-medium text-gray-900">Total Solicitado</span>
                            <span className="text-lg font-bold">{total}</span>
                        </div>
                        <div className="flex flex-col text-right">
                            <span className="font-medium text-gray-900">Entregado Actual</span>
                            <span className="text-lg font-bold">{currentDelivered}</span>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="amount">Cantidad a Entregar Ahora</Label>
                        <Input
                            id="amount"
                            type="number"
                            placeholder="Ej: 5"
                            value={amountToAdd}
                            onChange={(e) => setAmountToAdd(e.target.value)}
                            className="font-mono text-lg"
                            autoFocus
                        />
                    </div>

                    <div className="text-sm p-3 border rounded-lg bg-blue-50/50 border-blue-100 flex flex-col gap-1">
                        <div className="flex justify-between font-medium">
                            <span>Nuevo Total Entregado:</span>
                            <span className={isExceeding ? "text-orange-600" : "text-blue-700"}>
                                {newTotal} / {total}
                            </span>
                        </div>
                        <div className="flex justify-between text-gray-500 text-xs">
                            <span>Pendiente Restante:</span>
                            <span>{remaining}</span>
                        </div>
                        {isExceeding && (
                            <div className="text-xs text-orange-600 font-medium mt-1">
                                ⚠ Esta entrega excede el total solicitado.
                            </div>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={isSubmitting || !amountToAdd}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Registrar Entrega
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
