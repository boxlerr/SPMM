import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";

interface DeliveryProgressProps {
    total: number | null | undefined;
    delivered: number | null | undefined;
    compact?: boolean;
    className?: string; // Allow custom styling
}

export function DeliveryProgress({ total, delivered, compact = false, className }: DeliveryProgressProps) {
    // 1. Handle "No Data" case
    if (total === null || total === undefined || total === 0) {
        if (compact) {
            return <span className="text-gray-400 text-xs">-</span>;
        }
        return (
            <div className={cn("text-gray-400 text-sm italic", className)}>
                Sin datos de entrega
            </div>
        );
    }

    const deliveredVal = delivered || 0;

    // 2. Calculate percentage
    let percentage = Math.round((deliveredVal / total) * 100);
    const isOverflow = deliveredVal > total;

    // Cap visual percentage at 100 for proper bar rendering, unless we want to show overflow specifically?
    // User requested "capear porcentaje a 100% para UI" in warnings.
    const visualPercentage = Math.min(percentage, 100);
    const pending = Math.max(0, total - deliveredVal);

    // 3. Determine State & Color
    let statusText = "";
    let statusColor = "";
    let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
    let badgeClass = "";
    let icon = null;

    if (deliveredVal === 0) {
        statusText = "Sin entregar";
        statusColor = "bg-red-500";
        badgeVariant = "destructive"; // Or custom red
        badgeClass = "bg-red-100 text-red-800 hover:bg-red-200 border-red-200";
        icon = <Clock className="w-3 h-3 mr-1" />;
    } else if (isOverflow) {
        statusText = "Excede total";
        statusColor = "bg-orange-600"; // Warning color
        badgeVariant = "destructive";
        badgeClass = "bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-200";
        icon = <AlertTriangle className="w-3 h-3 mr-1" />;
    } else if (percentage >= 100) {
        statusText = "Entrega completa";
        statusColor = "bg-green-500";
        badgeVariant = "default"; // Or custom green
        badgeClass = "bg-green-100 text-green-800 hover:bg-green-200 border-green-200";
        icon = <CheckCircle2 className="w-3 h-3 mr-1" />;
    } else {
        statusText = "Entrega parcial";
        statusColor = "bg-yellow-500";
        badgeVariant = "secondary"; // Or custom yellow
        badgeClass = "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-yellow-200";
        icon = <Clock className="w-3 h-3 mr-1" />;
    }

    // 4. Render Layouts

    // COMPACT MODE (Table Cell)
    if (compact) {
        return (
            <div className={cn("flex flex-col items-start gap-1", className)}>
                <Badge variant={badgeVariant} className={cn("whitespace-nowrap font-medium px-2 py-0.5 h-auto text-[10px] uppercase tracking-wide", badgeClass)}>
                    {icon} {statusText}
                </Badge>
                <div className="text-xs font-medium text-gray-700 w-full flex justify-between items-center gap-2">
                    <span>
                        {deliveredVal} <span className="text-gray-400">/</span> {total}
                    </span>
                    <span className="text-[10px] text-gray-500">({percentage}%)</span>
                </div>
                {/* Optional thin bar for compact mode */}
                <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mt-0.5">
                    <div
                        className={cn("h-full transition-all duration-500", statusColor)}
                        style={{ width: `${visualPercentage}%` }}
                    />
                </div>
            </div>
        );
    }

    // NORMAL MODE (Detail Header)
    return (
        <div className={cn("p-4 bg-white rounded-xl border border-gray-100 shadow-sm", className)}>
            <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center mb-1">
                    <h4 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                        Entrega
                    </h4>
                    <Badge variant={badgeVariant} className={cn("px-2.5 py-0.5", badgeClass)}>
                        {icon} {statusText}
                    </Badge>
                </div>

                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                        className={cn("h-full transition-all duration-700 ease-out shadow-sm", statusColor)}
                        style={{ width: `${visualPercentage}%` }}
                    />
                </div>

                <div className="grid grid-cols-3 gap-4 pt-1">
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase text-gray-400 font-semibold tracking-wide">Total</span>
                        <span className="text-lg font-bold text-gray-900">{total}</span>
                    </div>
                    <div className="flex flex-col border-l border-gray-100 pl-4">
                        <span className="text-[10px] uppercase text-gray-400 font-semibold tracking-wide">Entregadas</span>
                        <span className={cn("text-lg font-bold", isOverflow ? "text-orange-600" : "text-gray-900")}>
                            {deliveredVal}
                        </span>
                    </div>
                    <div className="flex flex-col border-l border-gray-100 pl-4">
                        <span className="text-[10px] uppercase text-gray-400 font-semibold tracking-wide">Pendientes</span>
                        <span className="text-lg font-bold text-gray-400">{pending}</span>
                    </div>
                </div>

                {isOverflow && (
                    <div className="mt-2 text-xs text-orange-600 font-medium flex items-center bg-orange-50 p-2 rounded-md">
                        <AlertTriangle className="w-3 h-3 mr-1.5" />
                        Atención: La cantidad entregada excede el total planificado.
                    </div>
                )}
            </div>
        </div>
    );
}
