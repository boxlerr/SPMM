"use client";

import React, { useState, useMemo } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { User, Briefcase, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface OperatorLoadTabProps {
    planificacion: any[];
    operarios: any[];
    ordenes: any[];
}

export function OperatorLoadTab({ planificacion, operarios, ordenes }: OperatorLoadTabProps) {
    const [selectedOperator, setSelectedOperator] = useState<string>("all");
    const [selectedProcess, setSelectedProcess] = useState<string>("all");

    // 1. Enrich all data first to get available operators and processes for filters
    const allEnrichedItems = useMemo(() => {
        return planificacion.map((item) => {
            const order = ordenes.find((o) => o.id === item.orden_id);
            const orderProcess = order?.procesos?.find((p: any) => p.proceso.id === item.proceso_id);

            const tiempoProcesoValue = orderProcess?.tiempo_proceso || 0;
            const ordenProcesoValue = orderProcess?.orden || item.secuencia || 1;

            // Operator lookup - Try multiple sources
            let operatorNameValue = "Sin asignar";
            let opIdForGrouping = item.id_operario || 0;

            if (item.id_operario) {
                const op = operarios.find((o) => o.id === item.id_operario);
                if (op) {
                    operatorNameValue = `${op.nombre} ${op.apellido}`.trim();
                }
            }

            // If still not found by ID, try names from planning item
            if (operatorNameValue === "Sin asignar" && (item.nombre_operario || item.apellido_operario)) {
                operatorNameValue = `${item.nombre_operario || ""} ${item.apellido_operario || ""}`.trim();
            }

            // If still not found, try name from work order process
            if (operatorNameValue === "Sin asignar" && orderProcess?.operario_nombre) {
                operatorNameValue = orderProcess.operario_nombre.trim();
            }

            // If we have a name but no ID, try to find the ID for grouping
            if (opIdForGrouping === 0 && operatorNameValue !== "Sin asignar") {
                const foundOp = operarios.find(o => `${o.nombre} ${o.apellido}`.trim().toLowerCase() === operatorNameValue.toLowerCase());
                if (foundOp) opIdForGrouping = foundOp.id;
            }

            return {
                ...item,
                order_detail: order,
                process_name_display: item.nombre_proceso || orderProcess?.proceso.nombre || "Proceso no definido",
                operator_name_display: operatorNameValue,
                group_op_id: opIdForGrouping,
                tiempo_proceso_display: tiempoProcesoValue,
                orden_proceso_display: ordenProcesoValue
            };
        });
    }, [planificacion, operarios, ordenes]);

    // 2. Get unique operators and processes for filter dropdowns
    const { uniqueOperators, uniqueProcesses } = useMemo(() => {
        const ops = new Map<string, string>();
        const Procs = new Set<string>();

        allEnrichedItems.forEach(item => {
            if (item.operator_name_display && !item.operator_name_display.toUpperCase().includes("VACANTE")) {
                ops.set(item.operator_name_display, item.operator_name_display);
            }
            if (item.process_name_display) {
                // Normalizar a mayúsculas para los filtros
                const procUpper = item.process_name_display.toUpperCase();
                Procs.add(procUpper);
            }
        });

        return {
            uniqueOperators: Array.from(ops.values()).sort(),
            uniqueProcesses: Array.from(Procs).sort()
        };
    }, [allEnrichedItems]);

    // 3. Filter and Group
    const processedData = useMemo(() => {
        // Filter
        const filtered = allEnrichedItems.filter((item) => {
            const isVacante = item.operator_name_display.toUpperCase().includes("VACANTE");
            if (isVacante) return false;

            const matchesOperator = selectedOperator === "all" || item.operator_name_display === selectedOperator;
            
            // Comparación insensible a mayúsculas para el filtro de proceso
            const processNameUpper = item.process_name_display.toUpperCase();
            const matchesProcess = selectedProcess === "all" || processNameUpper === selectedProcess.toUpperCase();
            
            return matchesOperator && matchesProcess;
        });

        // Group by operator and calculate accumulated time
        const grouped: any[] = [];
        const operatorTimeMap = new Map<any, number>();

        // Sort items: Group by operator (id or name), then by start time or order
        const sorted = [...filtered].sort((a, b) => {
            const opA = a.group_op_id || a.operator_name_display;
            const opB = b.group_op_id || b.operator_name_display;
            if (opA !== opB) return String(opA).localeCompare(String(opB));

            // Secondary sort by date
            if (a.fecha_inicio_estimada && b.fecha_inicio_estimada) {
                return new Date(a.fecha_inicio_estimada).getTime() - new Date(b.fecha_inicio_estimada).getTime();
            }
            return (a.orden_proceso_display || 0) - (b.orden_proceso_display || 0);
        });

        sorted.forEach((item) => {
            const opKey = item.group_op_id || item.operator_name_display;
            const currentTime = operatorTimeMap.get(opKey) || 0;
            const newTime = currentTime + (item.tiempo_proceso_display || 0);
            operatorTimeMap.set(opKey, newTime);

            const op = operarios.find(o => (o.id === item.id_operario) || (`${o.nombre} ${o.apellido}`.trim().toLowerCase() === item.operator_name_display.toLowerCase()));
            const resStart = op?.hora_inicio || "09:00";
            const resEnd = op?.hora_fin || "18:00";
            const [sh, sm] = resStart.split(':').map(Number);
            const [eh, em] = resEnd.split(':').map(Number);
            const totalMins = (eh * 60 + em) - (sh * 60 + sm);

            grouped.push({
                ...item,
                acumulado: newTime,
                dias_ocupados: (newTime / (totalMins || 495)).toFixed(2),
                jornada_mins: totalMins || 495
            });
        });

        return grouped;
    }, [allEnrichedItems, selectedOperator, selectedProcess]);

    return (
        <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Filters Header */}
            <div className="p-4 border-b bg-gray-50/50 flex flex-wrap gap-4 items-center">
                <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        <User className="h-3 w-3" />
                        <span>Operario</span>
                    </div>
                    <Select value={selectedOperator} onValueChange={setSelectedOperator}>
                        <SelectTrigger className="w-full bg-white">
                            <SelectValue placeholder="Todos los operarios" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos los operarios</SelectItem>
                            {uniqueOperators.map(op => (
                                <SelectItem key={op} value={op}>{op}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        <Briefcase className="h-3 w-3" />
                        <span>Proceso</span>
                    </div>
                    <SearchableSelect
                        value={selectedProcess}
                        onValueChange={setSelectedProcess}
                        placeholder="Todos los procesos"
                        className="bg-white"
                        options={[
                            { value: "all", label: "TODOS LOS PROCESOS" },
                            ...uniqueProcesses.map(p => ({ value: p, label: p }))
                        ]}
                    />
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 font-medium px-2 py-1 bg-white rounded-lg border border-gray-100 shadow-sm self-end mb-1">
                    <Clock className="h-3.5 w-3.5 text-blue-500" />
                    <span>Jornada: {selectedOperator !== "all" ? (processedData[0]?.jornada_mins / 60).toFixed(2) + "hs" : "Variable"}</span>
                </div>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-auto">
                <Table>
                    <TableHeader className="bg-gray-50 sticky top-0 z-10">
                        <TableRow>
                            <TableHead className="w-[200px] font-semibold">Empleado</TableHead>
                            <TableHead className="w-[150px] font-semibold">Proceso</TableHead>
                            <TableHead className="w-[80px] text-center font-semibold">Orden Proceso</TableHead>
                            <TableHead className="w-[100px] text-center font-semibold">OT</TableHead>
                            <TableHead className="w-[100px] text-right font-semibold">Tiempo (min)</TableHead>
                            <TableHead className="w-[120px] text-right font-semibold">Acumulado (min)</TableHead>
                            <TableHead className="w-[120px] text-right font-semibold">Días Ocupados</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {processedData.length > 0 ? (
                            processedData.map((item, index) => {
                                // Determine if this is the start of a new operator group for visual separation
                                const isFirstInGroup = index === 0 ||
                                    (item.group_op_id !== processedData[index - 1].group_op_id) ||
                                    (item.group_op_id === 0 && item.operator_name_display !== processedData[index - 1].operator_name_display);

                                return (
                                    <TableRow
                                        key={`${item.id}-${index}`}
                                        className={cn(
                                            "hover:bg-gray-50/50 transition-colors",
                                            isFirstInGroup && index !== 0 && "border-t-2 border-gray-100"
                                        )}
                                    >
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <div className={cn(
                                                    "w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold transition-opacity",
                                                    !isFirstInGroup && "opacity-40" // Sutil opacidad para los que se repiten para no sobrecargar
                                                )}>
                                                    {item.operator_name_display.charAt(0)}
                                                </div>
                                                <span className={cn(!isFirstInGroup && "text-gray-600 font-normal")}>
                                                    {item.operator_name_display}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-semibold border-amber-200 bg-amber-50 text-amber-700 tracking-wider">
                                                {item.process_name_display.toUpperCase()}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold">
                                                {item.orden_proceso_display}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center font-mono text-xs">
                                            #{item.orden_id}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <span className="text-gray-600">{item.tiempo_proceso_display}</span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <span className="font-semibold text-blue-600">{item.acumulado}</span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Badge className={cn(
                                                "font-bold",
                                                parseFloat(item.dias_ocupados) > 5 ? "bg-red-100 text-red-700 hover:bg-red-200" :
                                                    parseFloat(item.dias_ocupados) > 3 ? "bg-amber-100 text-amber-700 hover:bg-amber-200" :
                                                        "bg-green-100 text-green-700 hover:bg-green-200"
                                            )}>
                                                {item.dias_ocupados} d
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        ) : (
                            <TableRow>
                                <TableCell colSpan={7} className="h-32 text-center text-gray-500 italic">
                                    No se encontraron asignaciones para los filtros aplicados.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
