
import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays, AlertTriangle, Loader2 } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface AvailabilityConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AvailabilityConfigModal({ isOpen, onClose }: AvailabilityConfigModalProps) {
    const [blockedDates, setBlockedDates] = useState<Date[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchBlockedDates();
        }
    }, [isOpen]);

    const fetchBlockedDates = async () => {
        try {
            setIsLoading(true);
            const res = await fetch(`${API_URL}/config/availability`);
            if (res.ok) {
                const data = await res.json();
                // Parse "YYYY-MM-DD" to Date objects (fixing timezone offset issues by treating as local noon)
                const dates = (data.blocked_dates || []).map((d: string) => {
                    const [y, m, day] = d.split('-').map(Number);
                    return new Date(y, m - 1, day);
                });
                setBlockedDates(dates);
            }
        } catch (error) {
            console.error("Error fetching blocked dates:", error);
            toast.error("Error al cargar fechas bloqueadas");
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectDate = async (date: Date | undefined) => {
        if (!date) return;

        // Check if already blocked (compare string to avoid time issues)
        const dateStr = format(date, "yyyy-MM-dd");
        const isBlocked = blockedDates.some(d => format(d, "yyyy-MM-dd") === dateStr);

        setIsSaving(true);
        try {
            if (isBlocked) {
                // Remove
                const res = await fetch(`${API_URL}/config/availability/${dateStr}`, {
                    method: "DELETE"
                });
                if (!res.ok) throw new Error("Failed to remove");

                setBlockedDates(prev => prev.filter(d => format(d, "yyyy-MM-dd") !== dateStr));
                toast.success("Fecha desbloqueada");
            } else {
                // Add
                const res = await fetch(`${API_URL}/config/availability`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ date: dateStr })
                });
                if (!res.ok) throw new Error("Failed to add");

                setBlockedDates(prev => [...prev, date]);
                toast.success("Fecha bloqueada como no laboral");
            }
        } catch (error) {
            console.error("Error updating date:", error);
            toast.error("Error al actualizar disponibilidad");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarDays className="w-5 h-5 text-blue-600" />
                        Configurar Disponibilidad
                    </DialogTitle>
                    <DialogDescription>
                        Seleccione los días en los que <b>NO se trabajará</b> (feriados, mantenimiento). El sistema evitará planificar en estos días.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col items-center justify-center p-4">
                    {isLoading ? (
                        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                    ) : (
                        <div className="p-4 border rounded-lg bg-gray-50/50">
                            <Calendar
                                mode="single"
                                selected={undefined}
                                onSelect={handleSelectDate}
                                modifiers={{
                                    blocked: blockedDates
                                }}
                                modifiersStyles={{
                                    blocked: {
                                        backgroundColor: "#fee2e2",
                                        color: "#ef4444",
                                        fontWeight: "bold",
                                        textDecoration: "line-through"
                                    }
                                }}
                                className="rounded-md border bg-white"
                                locale={es}
                            />
                        </div>
                    )}

                    <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                        <div className="w-4 h-4 bg-red-100 border border-red-200 rounded flex items-center justify-center text-xs text-red-600 font-bold line-through">12</div>
                        <span>Días no laborales (Click para alternar)</span>
                    </div>
                </div>

                <DialogFooter>
                    <Button onClick={onClose}>Cerrar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
