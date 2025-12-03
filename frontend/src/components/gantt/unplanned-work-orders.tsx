import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

interface OrdenTrabajo {
    id: number;
    id_otvieja: string;
    fecha_prometida: string;
    prioridad: {
        descripcion: string;
    };
    articulo: {
        descripcion: string;
    };
    sector: {
        nombre: string;
    };
}

export function UnplannedWorkOrders() {
    const [ordenes, setOrdenes] = useState<OrdenTrabajo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('http://localhost:8000/ordenes-no-planificadas')
            .then(res => res.json())
            .then(data => {
                if (data.status) {
                    setOrdenes(data.data);
                }
            })
            .catch(err => console.error("Error fetching unplanned orders:", err))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return null;

    if (ordenes.length === 0) {
        return (
            <Card className="mt-8 border-green-200 bg-green-50/30">
                <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="rounded-full bg-green-100 p-3 mb-4">
                        <AlertCircle className="h-6 w-6 text-green-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-green-900">¡Todo al día!</h3>
                    <p className="text-sm text-green-700 mt-1">
                        Todas las órdenes de trabajo están planificadas correctamente.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="mt-8 border-orange-200 bg-orange-50/30">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-700">
                    <AlertCircle className="h-5 w-5" />
                    Órdenes No Planificadas
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="relative w-full overflow-auto">
                    <table className="w-full caption-bottom text-sm">
                        <thead className="[&_tr]:border-b">
                            <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                                    OT ID
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                                    Artículo
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                                    Sector
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                                    Fecha Prometida
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                                    Prioridad
                                </th>
                            </tr>
                        </thead>
                        <tbody className="[&_tr:last-child]:border-0">
                            {ordenes.map((orden) => (
                                <tr
                                    key={orden.id}
                                    className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                                >
                                    <td className="p-4 align-middle font-medium">{orden.id_otvieja}</td>
                                    <td className="p-4 align-middle">{orden.articulo?.descripcion || '-'}</td>
                                    <td className="p-4 align-middle">{orden.sector?.nombre || '-'}</td>
                                    <td className="p-4 align-middle">{new Date(orden.fecha_prometida).toLocaleDateString()}</td>
                                    <td className="p-4 align-middle">
                                        <Badge variant="outline" className="capitalize">
                                            {orden.prioridad?.descripcion || 'Normal'}
                                        </Badge>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
}
