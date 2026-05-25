import { LogIn } from "lucide-react";
import { loginRequest } from "../authConfig";
import { useMsal } from "@azure/msal-react";
import Swal from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
import { Button } from "../components/ui";

const SwalMessages = withReactContent(Swal);

/**
 * Login — pantalla de acceso.
 *
 * Responsabilidad ÚNICA: mostrar la UI y disparar `loginRedirect()`. El
 * handshake post-redirect (validateSession + setUser) vive en
 * `SessionContext.tsx` porque ese componente sobrevive al desmonte de
 * `<Login />` cuando AppRouter detecta `isAuthenticated=true`.
 *
 * Bug que esto previene:
 *   Con `loginPopup` el callback se ejecutaba inline en este componente.
 *   Con `loginRedirect`, la página re-carga, MSAL marca al user como
 *   autenticado, AppRouter desmonta `<Login />`, y cualquier `useEffect`
 *   que viviera aquí jamás corría → spinner infinito en MainLayout.
 */
const Login = () => {
    const { instance } = useMsal();

    const handleLoginRedirect = async () => {
        try {
            await instance.loginRedirect({
                ...loginRequest,
                redirectUri: window.location.origin,
            });
            // No hay código aquí post-call: la página ya navegó away.
        } catch (error) {
            console.error("[Login] loginRedirect failed:", error);
            await SwalMessages.fire({
                title: "Error al iniciar sesión",
                text: "No se pudo iniciar el flujo de autenticación. Intenta nuevamente.",
                icon: "error",
                confirmButtonColor: "#1d4ed8",
            });
        }
    };

    return (
        <div className="min-h-screen flex bg-slate-50">
            {/* ============================ Lado izquierdo (hero) =================
                Sólo visible en lg+. En mobile se oculta para que la card de login
                ocupe toda la pantalla y no obligue a scrollear. */}
            <div className="hidden lg:flex relative w-3/5 overflow-hidden">
                {/* Background gradient con la paleta brand */}
                <div className="absolute inset-0 bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500" />

                {/* Decorative blobs — círculos blured para dar profundidad sin
                    necesidad de assets externos. Inspirados en Tabler/Vuexy. */}
                <div className="absolute -top-20 -left-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
                <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-brand-300/30 blur-3xl" />
                <div className="absolute top-1/2 left-1/3 h-64 w-64 rounded-full bg-sky-300/20 blur-3xl" />

                <div className="relative z-10 flex flex-col justify-between w-full p-12 text-white">
                    {/* Logo + brand */}
                    <div className="flex items-center gap-3">
                        <img
                            src="/logo.svg"
                            alt="Ingenial IA"
                            className="h-40 w-40"
                        />
                        <div>
                            <p className="text-lg font-bold leading-none">
                                Ingenial IA
                            </p>
                            <p className="text-xs text-white/70 mt-0.5">
                                Suite de productos
                            </p>
                        </div>
                    </div>

                    {/* Hero copy */}
                    <div className="max-w-lg">
                        <h1 className="text-5xl font-bold tracking-tight leading-[1.1]">
                            Bienvenido a nuestra plataforma.
                        </h1>
                        <p className="mt-6 text-lg text-white/80 leading-relaxed">
                            Para mayor información y/o soporte contáctenos al 3104366231
                        </p>

                        {/* Lista de "selling points" — añade densidad sin caer
                            en walls of text. */}
                    </div>

                    {/* Footer copyright */}
                    <p className="text-xs text-white/60">
                        © {new Date().getFullYear()} Ingenial IA. Todos los
                        derechos reservados.
                    </p>
                </div>
            </div>

            {/* ============================ Lado derecho (form) ================== */}
            <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
                <div className="w-full max-w-md">
                    {/* Logo arriba — sólo visible en mobile (cuando el hero
                        está oculto). En desktop ya hay logo en el panel
                        izquierdo. */}
                    <div className="lg:hidden flex justify-center mb-8">
                        <img
                            src="/logo.svg"
                            alt="Ingenial IA"
                            className="h-12 w-12"
                        />
                    </div>

                    <div className="text-center lg:text-left">
                        <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
                            Iniciar Sesión.
                        </h2>
                    </div>

                    <div className="mt-10 space-y-4">
                        <Button
                            size="lg"
                            fullWidth
                            leftIcon={<LogIn />}
                            onClick={handleLoginRedirect}
                        >
                            Ingresar a mi cuenta.
                        </Button>

                        <div className="flex items-center gap-3">
                            <hr className="flex-1 border-slate-200" />
                            <span className="text-xs text-slate-400 font-medium">
                                o
                            </span>
                            <hr className="flex-1 border-slate-200" />
                        </div>

                        <Button
                            variant="secondary"
                            size="lg"
                            fullWidth
                            disabled
                            title="Próximamente"
                        >
                            Registrarme
                        </Button>
                    </div>

                    <p className="mt-10 text-xs text-center text-slate-400">
                        Al continuar aceptas las políticas de uso y privacidad
                        de Ingenial IA.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
