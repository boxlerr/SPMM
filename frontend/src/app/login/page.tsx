"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [currentView, setCurrentView] = useState<
    "login" | "register" | "forgot"
  >("login");
  const router = useRouter();

  // Función de login sin validaciones - comentadas las verificaciones
  const handleLogin = () => {
    // TODO: Comentadas las validaciones de login por ahora
    // const email = (document.getElementById('email') as HTMLInputElement)?.value;
    // const password = (document.getElementById('password') as HTMLInputElement)?.value;
    
    // if (!email || !password) {
    //   alert('Por favor ingresa email y contraseña');
    //   return;
    // }
    
    // if (!email.includes('@')) {
    //   alert('Por favor ingresa un email válido');
    //   return;
    // }
    
    // Simular login exitoso - redirigir al Dashboard
    console.log('Login exitoso - sin validaciones');
    router.push('/dashboard'); // Redirigir al Dashboard
  };

  return (
    <div className="min-h-screen flex font-sans">
      <div
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
        style={{ backgroundColor: "#DC143C" }}
      >
        <div className="relative z-10 flex flex-col justify-between w-full px-12 py-12">
          <div className="flex items-center">
            <div className="bg-white rounded-lg p-2 mr-3 flex items-center justify-center border-4 border-white shadow-lg">
              <Image 
                src="/logo.png" 
                alt="Metalúrgica Longchamps" 
                width={48} 
                height={48}
              />
            </div>
            <h1 className="text-xl font-semibold text-white">Metalúrgica Longchamps</h1>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            <h2 className="text-4xl text-white mb-6 leading-tight">
              Gestiona tus operaciones de manera eficiente.
            </h2>
            <p className="text-white/90 text-lg leading-relaxed">
              Inicia sesión para acceder a tu panel SPMM y gestionar tu equipo.
            </p>
          </div>

          <div className="flex justify-between items-center text-white/70 text-sm">
            <span>Copyright © 2025 Vaxler.</span>
          </div>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden text-center mb-8">
            <Image 
              src="/longchamps_logo.png" 
              alt="Metalúrgica Longchamps" 
              width={300} 
              height={120}
              className="mx-auto mb-3"
            />
          </div>

          <div className="space-y-6">
            <div className="space-y-2 text-center relative">
              {currentView === "forgot" && (
                <Button
                  onClick={() => setCurrentView("login")}
                  className="absolute left-0 top-0 p-2 hover:bg-gray-100 cursor-pointer bg-transparent shadow-none border-none"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <h2 className="text-3xl text-foreground">
                {currentView === "login" && "Bienvenido de Vuelta"}
                {currentView === "register" && "Crear Cuenta"}
                {currentView === "forgot" && "Restablecer Contraseña"}
              </h2>
              <p className="text-muted-foreground">
                {currentView === "login" &&
                  "Ingresa tu email y contraseña para acceder a tu cuenta."}
                {currentView === "register" &&
                  "Crea una nueva cuenta para comenzar con Metalúrgica Longchamps."}
                {currentView === "forgot" &&
                  "Ingresa tu dirección de email y te enviaremos un enlace de restablecimiento."}
              </p>
            </div>

            <div className="space-y-4">
              {currentView === "register" && (
                <div className="space-y-2">
                  <Label
                    htmlFor="name"
                    className="text-sm font-medium text-foreground"
                  >
                    Nombre Completo
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Juan Pérez"
                    className="h-12 border-gray-200 focus:ring-0 shadow-none rounded-lg bg-white focus:border-[#DC143C]"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label
                  htmlFor="email"
                  className="text-sm font-medium text-foreground"
                >
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="usuario@empresa.com"
                  className="h-12 border-gray-200 focus:ring-0 shadow-none rounded-lg bg-white focus:border-[#DC143C]"
                />
              </div>

              {currentView !== "forgot" && (
                <div className="space-y-2">
                  <Label
                    htmlFor="password"
                    className="text-sm font-medium text-foreground"
                  >
                    Contraseña
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Ingresa tu contraseña"
                      className="h-12 pr-10 border-gray-200 focus:ring-0 shadow-none rounded-lg bg-white focus:border-[#DC143C]"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {currentView === "register" && (
                <div className="space-y-2">
                  <Label
                    htmlFor="confirmPassword"
                    className="text-sm font-medium text-foreground"
                  >
                    Confirmar Contraseña
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirma tu contraseña"
                      className="h-12 pr-10 border-gray-200 focus:ring-0 shadow-none rounded-lg bg-white focus:border-[#DC143C]"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {currentView === "login" && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="remember"
                      className="rounded border-gray-300 cursor-pointer"
                    />
                    <Label
                      htmlFor="remember"
                      className="text-sm text-muted-foreground cursor-pointer"
                    >
                      Recordarme
                    </Label>
                  </div>
                  <button
                    onClick={() => setCurrentView("forgot")}
                    className="text-sm font-medium text-[#DC143C] hover:opacity-80 cursor-pointer"
                  >
                    ¿Olvidaste tu Contraseña?
                  </button>
                </div>
              )}
            </div>

            <Button
              className="w-full h-12 text-sm font-medium text-white hover:opacity-90 rounded-lg shadow-none cursor-pointer"
              style={{ backgroundColor: "#DC143C" }}
              onClick={currentView === "login" ? handleLogin : undefined}
            >
              {currentView === "login" && "Iniciar Sesión"}
              {currentView === "register" && "Crear Cuenta"}
              {currentView === "forgot" && "Enviar Enlace de Restablecimiento"}
            </Button>

            <div className="text-center text-sm text-muted-foreground">
              {currentView === "login" && (
                <>
                  ¿No tienes una cuenta?{" "}
                  <button
                    onClick={() => setCurrentView("register")}
                    className="text-[#DC143C] font-medium hover:opacity-80"
                  >
                    Regístrate ahora.
                  </button>
                </>
              )}
              {currentView === "register" && (
                <>
                  ¿Ya tienes una cuenta?{" "}
                  <button
                    onClick={() => setCurrentView("login")}
                    className="text-[#DC143C] font-medium hover:opacity-80"
                  >
                    Inicia Sesión.
                  </button>
                </>
              )}
              {currentView === "forgot" && (
                <>
                  ¿Recuerdas tu contraseña?{" "}
                  <button
                    onClick={() => setCurrentView("login")}
                    className="text-[#DC143C] font-medium hover:opacity-80"
                  >
                    Volver al Inicio de Sesión.
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
