"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw } from "lucide-react";

interface Proceso {
  id: number;
  nombre: string | null;
  descripcion: string | null;
}

export default function PlanificacionPage() {
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProcesos = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const cleanUrl = apiUrl.replace(/\/$/, "");

      const response = await fetch(`${cleanUrl}/procesos`);

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();

      // 🔥 Extraer el array del objeto ResponseDTO
      if (responseData.status && responseData.data) {
        setProcesos(Array.isArray(responseData.data) ? responseData.data : []);
      } else {
        setError(responseData.errorDescription || "Error al cargar procesos");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar procesos");
      console.error("Error fetching procesos:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProcesos();
  }, []);

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Planificación</h1>
          <p className="text-muted-foreground mt-2">
            Gestión de procesos del sistema
          </p>
        </div>
        <Button
          onClick={fetchProcesos}
          disabled={loading}
          variant="outline"
          size="sm"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
          />
          Actualizar
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
          <span className="ml-3 text-muted-foreground">
            Cargando procesos...
          </span>
        </div>
      )}

      {!loading && !error && procesos.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <p className="text-lg">No hay procesos disponibles</p>
              <p className="text-sm mt-2">
                Los procesos aparecerán aquí cuando estén disponibles en la API
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && !error && procesos.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {procesos.map((proceso) => (
            <Card
              key={proceso.id}
              className="hover:shadow-lg transition-shadow"
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="text-balance">
                    {proceso.nombre || "Sin nombre"}
                  </span>
                  <span className="text-sm font-mono text-muted-foreground">
                    #{proceso.id}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-pretty">
                  {proceso.descripcion || "Sin descripción"}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
