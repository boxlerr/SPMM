import { useState } from "react";

export function useApi<T>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (url: string): Promise<T[]> => {
    setLoading(true);
    setError(null);

    try {
      console.log(`[useApi] Fetching data from: ${url}`);

      const token = localStorage.getItem('access_token');
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Error HTTP ${response.status}: ${response.statusText}. ${errorText}`);
      }

      const responseData = await response.json();

      if (responseData.status && responseData.data) {
        const data = Array.isArray(responseData.data) ? responseData.data : [];
        console.log(`[useApi] Successfully fetched ${data.length} items`);
        return data;
      } else {
        throw new Error(responseData.errorDescription || "Error al cargar datos");
      }
    } catch (err) {
      let message = "Error desconocido";

      if (err instanceof TypeError && err.message.includes("fetch")) {
        message = `No se pudo conectar con el backend. Verifica que el servidor esté corriendo en ${url}`;
      } else if (err instanceof Error) {
        message = err.message;
      }

      setError(message);
      console.error("[useApi] Error fetching:", err);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const executeOperation = async (
    url: string,
    method: "POST" | "PUT" | "DELETE",
    body?: any
  ): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('access_token');
      const headers: HeadersInit = {
        "Content-Type": "application/json"
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();
      if (!responseData.status) {
        throw new Error(responseData.errorDescription || "Operación fallida");
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setError(message);
      console.error("Error en operación:", err);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, setError, fetchData, executeOperation };
}

