/**
 * Utilidades para decodificar y validar JWTs del lado del cliente.
 *
 * Importante: este parser NO valida la firma. Sólo lee el payload para chequear
 * `exp` y evitar usar tokens que ya vencieron. La verdad final la tiene el backend.
 */

export interface JwtPayload {
    sub?: string;
    id_usuario?: number;
    rol?: string;
    nombre?: string;
    apellido?: string;
    /** Unix timestamp en segundos */
    exp?: number;
    /** Unix timestamp en segundos */
    iat?: number;
    [key: string]: unknown;
}

/**
 * Decodifica el payload de un JWT sin validar la firma.
 * Devuelve `null` si el token está malformado.
 */
export function decodeJwt(token: string): JwtPayload | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        // base64url -> base64
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);

        const json = typeof atob === 'function'
            ? atob(padded)
            : Buffer.from(padded, 'base64').toString('utf-8');

        // Soporta caracteres no-ASCII (utf-8) en el payload
        const decoded = decodeURIComponent(
            Array.from(json)
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );

        return JSON.parse(decoded) as JwtPayload;
    } catch {
        return null;
    }
}

/**
 * Devuelve `true` si el token está vencido o no se puede leer su `exp`.
 * Acepta un margen opcional `skewSeconds` para considerar vencido un poco antes
 * (útil para evitar carreras donde el cliente cree que vale por 1s pero el server lo rechaza).
 */
export function isTokenExpired(token: string, skewSeconds = 30): boolean {
    const payload = decodeJwt(token);
    if (!payload || typeof payload.exp !== 'number') return true;

    const nowSec = Math.floor(Date.now() / 1000);
    return payload.exp - skewSeconds <= nowSec;
}

/**
 * Milisegundos restantes hasta que vence el token. `null` si no se puede leer `exp`.
 * Si ya venció, devuelve un número negativo o cero.
 */
export function msUntilExpiry(token: string): number | null {
    const payload = decodeJwt(token);
    if (!payload || typeof payload.exp !== 'number') return null;
    return payload.exp * 1000 - Date.now();
}
