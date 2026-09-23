'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { erroresPorCampo, mensajeDeError, nombreDePersona } from '@/lib/permisosAdmin';
import { datos, pedir, type UsuarioFila } from './api';
import { Campo } from './NuevoUsuarioDialog';

/**
 * Editar los datos de una persona (EditarUsuarioDialog de Don Joaquín): nombre, apellido,
 * usuario y email. El rol se cambia desde la lista, al toque; los permisos, abajo.
 *
 * No hay campo de contraseña, a propósito: el de antes se mandaba y el backend lo
 * ignoraba (PUT /auth/usuarios no tiene contraseña), así que decía «modificado
 * correctamente» sin haber cambiado nada. La persona cambia la suya en «Mi cuenta».
 */

interface Props {
  usuario: UsuarioFila | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onGuardado: (cambios: Pick<UsuarioFila, 'id_usuario'> & Partial<UsuarioFila>) => void;
}

const RE_USERNAME = /^[a-zA-Z0-9_.]+$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EditarUsuarioDialog({ usuario, open, onOpenChange, onGuardado }: Props) {
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open || !usuario) return;
    setNombre(usuario.nombre ?? '');
    setApellido(usuario.apellido ?? '');
    setUsername(usuario.username ?? '');
    setEmail(usuario.email ?? '');
    setErrores({});
    setGuardando(false);
  }, [open, usuario]);

  const guardar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!usuario || guardando) return;
    const e: Record<string, string> = {};
    if (!nombre.trim()) e.nombre = 'Falta el nombre';
    if (!apellido.trim()) e.apellido = 'Falta el apellido';
    const u = username.trim();
    if (u.length < 3) e.username = 'Mínimo 3 letras';
    else if (!RE_USERNAME.test(u)) e.username = 'Sólo letras, números, _ y .';
    if (!RE_EMAIL.test(email.trim())) e.email = 'Ese email no es válido';
    setErrores(e);
    if (Object.keys(e).length) return;

    setGuardando(true);
    const cuerpo = { nombre: nombre.trim(), apellido: apellido.trim(), username: u, email: email.trim() };
    const r = await pedir(`/auth/usuarios/${usuario.id_usuario}`, { method: 'PUT', body: cuerpo });
    setGuardando(false);
    if (!r.ok) {
      if (r.red) {
        setErrores({ global: 'No se pudo guardar: revisá la conexión.' });
        return;
      }
      const porCampo = erroresPorCampo(r.cuerpo);
      setErrores(Object.keys(porCampo).length ? porCampo : { global: mensajeDeError(r.cuerpo, 'No se pudo guardar.') });
      return;
    }
    const d = (datos(r) ?? {}) as Partial<UsuarioFila>;
    onGuardado({
      id_usuario: usuario.id_usuario,
      nombre: d.nombre ?? cuerpo.nombre,
      apellido: d.apellido ?? cuerpo.apellido,
      username: d.username ?? cuerpo.username.toLowerCase(),
      email: d.email ?? cuerpo.email,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !guardando && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={guardar} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
            <DialogDescription>
              {usuario ? `Los datos de ${nombreDePersona(usuario)}. ` : ''}
              Si cambiás el usuario, es el que va a usar para entrar.
            </DialogDescription>
          </DialogHeader>
          {errores.global && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errores.global}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo id="eu-nombre" label="Nombre *" error={errores.nombre}>
              <Input id="eu-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Campo>
            <Campo id="eu-apellido" label="Apellido *" error={errores.apellido}>
              <Input id="eu-apellido" value={apellido} onChange={(e) => setApellido(e.target.value)} />
            </Campo>
          </div>
          <Campo id="eu-username" label="Usuario *" error={errores.username}>
            <Input
              id="eu-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </Campo>
          <Campo id="eu-email" label="Email *" error={errores.email}>
            <Input id="eu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando} className="bg-[#DC143C] hover:bg-[#B01030] text-white">
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
