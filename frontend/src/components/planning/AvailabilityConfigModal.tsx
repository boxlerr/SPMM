
import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays, AlertTriangle, Loader2 } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ListaFeriados, useFeriadosDelPais } from "./ListaFeriados";

const aFechas = (dias: string[]) => dias.map((d) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day);
});

interface AvailabilityConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Cambiaron los días que el planificador saltea (la pantalla de atrás cuenta con ellos). */
    onFeriadosCambiados?: (bloqueados: string[]) => void;
}

export function AvailabilityConfigModal({ isOpen, onClose, onFeriadosCambiados }: AvailabilityConfigModalProps) {
    const [blockedDates, setBlockedDates] = useState<Date[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Los feriados de Argentina se traen solos (8/10/2026); acá se elige si se trabajan.
    const ponerBloqueados = (dias: string[]) => {
        setBlockedDates(aFechas(dias));
        onFeriadosCambiados?.(dias);
    };
    const delPais = useFeriadosDelPais(isOpen, format(new Date(), "yyyy-MM-dd"), ponerBloqueados);

    const getAuthHeaders = (): HeadersInit => {
        if (typeof window === 'undefined') return {};
        const token = localStorage.getItem('access_token');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    };

    useEffect(() => {
        if (isOpen) {
            fetchBlockedDates();
        }
    }, [isOpen]);

    const fetchBlockedDates = async () => {
        try {
            setIsLoading(true);
            const res = await fetch(`${API_URL}/config/availability`, {
                headers: getAuthHeaders()
            });
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
                    method: "DELETE",
                    headers: getAuthHeaders()
                });
                if (!res.ok) throw new Error("Failed to remove");

                const data = await res.json().catch(() => null);
                if (Array.isArray(data?.blocked_dates)) ponerBloqueados(data.blocked_dates);
                else setBlockedDates(prev => prev.filter(d => format(d, "yyyy-MM-dd") !== dateStr));
                toast.success("Fecha desbloqueada");
            } else {
                // Add
                const res = await fetch(`${API_URL}/config/availability`, {
                    method: "POST",
                    headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                    body: JSON.stringify({ date: dateStr })
                });
                if (!res.ok) throw new Error("Failed to add");

                const data = await res.json().catch(() => null);
                if (Array.isArray(data?.blocked_dates)) ponerBloqueados(data.blocked_dates);
                else setBlockedDates(prev => [...prev, date]);
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
            <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarDays className="w-5 h-5 text-blue-600" />
                        Configurar Disponibilidad
                    </DialogTitle>
                    <DialogDescription>
                        Los feriados de Argentina se cargan solos; abajo elegís si el taller los trabaja. En el calendario marcá otros días en los que <b>no se trabaja</b> (mantenimiento, un paro). El planificador los saltea.
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
                    <ListaFeriados
                        feriados={delPais.feriados ?? []}
                        guardando={delPais.guardando}
                        onElegir={delPais.elegir}
                        titulo="Próximos feriados"
                        className="mt-4 w-full max-h-64 overflow-y-auto"
                    />
                </div>

                <DialogFooter>
                    <Button onClick={onClose}>Cerrar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
