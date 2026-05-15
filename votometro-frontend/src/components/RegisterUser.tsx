import type { IProductsFormData, IRegisterUserFormData } from "../interfaces/IRegisterUserFormData";
import type { IDepartment } from "../interfaces/IDepartments";
import type { IMunicipio } from "../interfaces/IMunicipio";
import { useAccessToken } from "../hooks/useAccessToken";
import ProductsSelector from "./ProductsSelector";
import type { IUserZone } from "../services/api";
import { createUser, getDepartments, getMunicipalities } from "../services/api";
import { useEffect, useState } from "react";


interface RegisterUserProps {
  onSuccess: () => void
}

const initialFormData: IRegisterUserFormData = {
  nombre: "",
  telefono: "",
  email: "",
  personalEmail: "",
  password: "",
  confirmPassword: "",
  referencia: "",
  referencia2: "",
  tipoPersona: "",
  tipoDNI: "",
  numeroDNI: "",
  tipoUsuario: "",
  tiempoContratacionVotometro: "",
  tiempoContratacionAudivoto: "",
  products: [],
};

const padDep = (value: string | number) => String(value).padStart(2, "0");
const toBackendZones = (zones: IUserZone[]): IUserZone[] =>
  zones.map((zone) => ({
    cod_dep: padDep(zone.cod_dep),
    cod_mun: zone.cod_mun == null ? null : String(zone.cod_mun).slice(-3).padStart(3, "0"),
  }));

const RegisterUser = ({ onSuccess }: RegisterUserProps) => {

  const { getToken } = useAccessToken();

  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Partial<IRegisterUserFormData>>({});
  const [productsErrors, setProductsErrors] = useState<{ [key: string]: string }>({});

  const [departamentos, setDepartamentos] = useState<IDepartment[]>([]);
  const [municipios, setMunicipios] = useState<IMunicipio[]>([]);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [failed, setFailed] = useState(false);

  const [formData, setFormData] = useState<IRegisterUserFormData>(initialFormData);

  const [votometroZones, setVotometroZones] = useState<IUserZone[]>([]);
  const [audivotoZones, setAudivotoZones] = useState<IUserZone[]>([]);

  // Enable/Disable state for products (for new users, both start enabled)
  const [votometroEnabled, setVotometroEnabled] = useState<boolean>(true);
  const [audivotoEnabled, setAudivotoEnabled] = useState<boolean>(true);

  const [productsFormData, setProductsFormData] = useState<IProductsFormData>({
    tiempoContratacionVotometro: "",
    tiempoContratacionAudivoto: "",
    initialProducts: [],
    newProducts: [],
  });

  useEffect(() => {
    getAvailableDepartments();
    getAvailableMunicipalities();
  }, []);

  const getAvailableDepartments = async () => {
    const token = await getToken();
    const data = await getDepartments(token);
    setDepartamentos(data);
  };

  const getAvailableMunicipalities = async () => {
    const token = await getToken();
    const data = await getMunicipalities(token);
    setMunicipios(data);
  };

  const validateVotometro = () => {
    const newErrors: { [key: string]: string } = {};
    if (!productsFormData.tiempoContratacionVotometro) {
      newErrors.tiempoContratacionVotometro = "El tiempo de contratación es requerido.";
    }

    if (votometroZones.length === 0) {
      newErrors.zonasVotometro = "Debe seleccionar al menos una zona.";
    }

    setProductsErrors((prev) => ({ ...prev, ...newErrors }));
    return Object.keys(newErrors).length === 0;
  };

  const validateAudivoto = () => {
    const newErrors: { [key: string]: string } = {};

    if (!productsFormData.tiempoContratacionAudivoto) {
      newErrors.tiempoContratacionAudivoto = "El tiempo de contratación es requerido.";
    }

    if (audivotoZones.length === 0) {
      newErrors.zonasAudivoto = "Debe seleccionar al menos una zona.";
    }

    setProductsErrors((prev) => ({ ...prev, ...newErrors }));
    return Object.keys(newErrors).length === 0;
  };

  const validateProducts = (): boolean => {
    // Check if at least one product is enabled
    const hasAtLeastOne = votometroEnabled || audivotoEnabled;

    if (!hasAtLeastOne) {
      setProductsErrors((prev) => ({
        ...prev,
        general: "Debe habilitar al menos un producto:\nVotómetro o Audivoto.",
      }));
      return false;
    }
    setProductsErrors((prev) => ({ ...prev, general: "" }));

    // Validate enabled products have required fields
    const votometroValid = votometroEnabled ? validateVotometro() : true;
    const audivotoValid = audivotoEnabled ? validateAudivoto() : true;

    return votometroValid && audivotoValid;
  };

  const validateForm = () => {
    const errors: Partial<IRegisterUserFormData> = {};

    if (step === 1) {
      if (!formData.nombre.trim()) errors.nombre = "El nombre es requerido.";

      if (!formData.email.trim()) {
        errors.email = "El email es requerido.";
      } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
        errors.email = "El email no es válido.";
      }

      if (!formData.telefono.trim()) {
        errors.telefono = "El teléfono es requerido.";
      } else if (!/^\+?\d{7,15}$/.test(formData.telefono)) {
        errors.telefono = "Formato de teléfono inválido.";
      }

      if (!formData.numeroDNI.trim()) {
        errors.numeroDNI = "El número de documento es requerido.";
      } else if (Number(formData.numeroDNI) < 10000000) {
        errors.numeroDNI = "El número debe ser mayor a 10 millones";
      } else {
        const numeroStr = formData.numeroDNI.toString();

        if (formData.tipoPersona === "Persona Natural") {
          if (numeroStr.length < 6 || numeroStr.length > 10) {
            errors.numeroDNI = "La cédula debe tener entre 6 y 10 dígitos.";
          }
        } else if (formData.tipoPersona === "Persona Jurídica") {
          if (numeroStr.length < 9 || numeroStr.length > 10) {
            errors.numeroDNI = "El NIT debe tener entre 9 y 10 dígitos.";
          }
        } else {
          if (numeroStr.length < 5 || numeroStr.length > 10) {
            errors.numeroDNI = "Formato de número de documento inválido.";
          }
        }
      }

      if (!formData.password) {
        errors.password = "La contraseña es requerida.";
      } else if (formData.password.length < 8) {
        errors.password = "Debe tener al menos 8 caracteres.";
      } else {
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
        if (!passwordRegex.test(formData.password)) {
          errors.password = "Debe tener al menos 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial.";
        }
      }

      if (formData.confirmPassword !== formData.password) {
        errors.confirmPassword = "Las contraseñas no coinciden.";
      }

      if (!formData.referencia.trim()) errors.referencia = "La referencia es requerida.";
      if (!formData.tipoUsuario.trim()) errors.tipoUsuario = "Debe seleccionar un tipo de usuario.";
      if (!formData.tipoPersona.trim()) errors.tipoPersona = "Debe seleccionar un tipo de persona.";
      if (!formData.tipoDNI.trim()) errors.tipoDNI = "Debe seleccionar un tipo de DNI.";
    } else if (step === 2) {

    }
    return errors;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    var formattedValue = value;

    if (name == 'telefono' || name == 'numeroDNI') {
      formattedValue = e.target.value.replace(/[^0-9]/g, "");
    }

    setFormData((prev) => ({
      ...prev,
      [name]: formattedValue,
    }));

    if (errors[name as keyof IRegisterUserFormData]) {
      setErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
  };

  const nextStep = () => {
    const currentErrors = validateForm();

    if (Object.keys(currentErrors).length > 0) {
      setErrors(currentErrors);
      return;
    }

    setErrors({});
    if (step < 2) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  const stepStyles = (index: number) =>
    `w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${step === index
      ? "border-orange-500"
      : step > index
        ? "bg-orange-500 border-orange-500 text-white"
        : "border-gray-300 bg-white"
    }`;

  const handleSubmit = (e: React.FormEvent<HTMLButtonElement>) => {
    e.preventDefault();

    if (!validateProducts()) {
      return;
    }

    setLoading(true);
    handleNewUser();
  };



  const handleCancelLoading = () => {
    setLoading(false);
  };

  const handleNewUser = async () => {

    const products = [];
    if (votometroEnabled) {
      const durationMatch = productsFormData.tiempoContratacionVotometro.match(/(\d+)/);
      products.push({
        name: "Votometro",
        contract_duration: durationMatch ? parseInt(durationMatch[1]) : 1,
        duration_unit: productsFormData.tiempoContratacionVotometro.includes("mes")
          ? "months"
          : (productsFormData.tiempoContratacionVotometro.includes("año") || productsFormData.tiempoContratacionVotometro.includes("aÃ±o"))
            ? "years"
            : "days",
        enable: true,
        amount_cop: 150000,
        zones: toBackendZones(votometroZones),
      });
    }
    if (audivotoEnabled) {
      const durationMatch = productsFormData.tiempoContratacionAudivoto.match(/(\d+)/);
      products.push({
        name: "Audivoto",
        contract_duration: durationMatch ? parseInt(durationMatch[1]) : 1,
        duration_unit: productsFormData.tiempoContratacionAudivoto.includes("mes")
          ? "months"
          : (productsFormData.tiempoContratacionAudivoto.includes("año") || productsFormData.tiempoContratacionAudivoto.includes("aÃ±o"))
            ? "years"
            : "days",
        enable: true,
        amount_cop: 150000,
        zones: toBackendZones(audivotoZones),
      });
    }

    const body = {
      "display_name": formData.nombre,
      "phone": formData.telefono,
      "email": formData.email,
      "personal_email": formData.personalEmail,
      "role": formData.tipoUsuario,
      "type_person": formData.tipoPersona,
      "type_dni": formData.tipoDNI,
      "identity_document": formData.numeroDNI,
      "reference": formData.referencia,
      "reference2": formData.referencia2,
      "password": formData.password,
      "products": products,
    };

    try {
      const token = await getToken();

      // Add timeout to prevent infinite loading
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado')), 30000)
      );

      await Promise.race([
        createUser(token, body),
        timeoutPromise
      ]);

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onSuccess();
      }, 2000);

    } catch (error) {
      setFailed(true);
      setTimeout(() => {
        setFailed(false);
      }, 3000);
      console.error("Error al crear usuario:", error);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="bg-white p-4">

      {loading && (
        <div className="fixed inset-0 bg-opacity-10 backdrop-blur-xs z-50 flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-orange-500 border-b-4"></div>
          <p className="mt-4 text-orange-600 text-sm font-semibold">Guardando...</p>
          <button
            onClick={handleCancelLoading}
            className="mt-4 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 underline"
          >
            Cancelar
          </button>
        </div>
      )}

      {success && (
        <div className="fixed inset-0 bg-white bg-opacity-80 z-50 flex flex-col items-center justify-center">
          <svg className="w-16 h-16 text-green-500 mb-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-green-600 text-lg font-semibold">¡Usuario creado exitosamente!</p>
          <p className="text-gray-500 text-sm mt-2">Redirigiendo al panel de usuarios...</p>
        </div>
      )}

      {failed && (
        <div className="fixed inset-0 bg-white bg-opacity-80 z-50 flex flex-col items-center justify-center">
          <svg className="w-16 h-16 text-red-500 mb-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <p className="text-red-600 text-lg font-semibold">No fue posible crear el usuario</p>
          <p className="text-gray-500 text-sm mt-2">Por favor, verifica los datos o intenta de nuevo más tarde.</p>
        </div>
      )}


      {/* Pasos */}
      <div className="flex items-center justify-between max-w-md mx-auto mb-0">
        {/* Paso 1 */}
        <div className="flex flex-col items-center mt-2">
          <div className={stepStyles(1)}>
            {step > 1 ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                stroke="currentColor"
                className="w-5 h-5 text-white transform scale-100 transition-transform duration-300 ease-out"
              >
                <path
                  d="M4 12.6111L8.92308 17.5L20 6.5"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : step === 1 ? (
              <div className="w-3.5 h-3.5 rounded-full bg-orange-500 transition-all duration-300 ease-in-out"></div>
            ) : null}
          </div>
          <span className="text-sm mt-2 text-orange-500 font-medium text-center">
            Información <br /> Personal
          </span>
        </div>

        <div className="relative w-1/1 h-0.5 mt-0 mb-8 bg-gray-300 overflow-hidden">
          <div
            className={`absolute top-0 left-0 h-full bg-orange-500 origin-left transition-transform duration-500 ease-in-out ${step > 1 ? "scale-x-100" : "scale-x-0"
              }`}
            style={{ width: "100%" }}
          />
        </div>

        {/* Paso 2 */}
        <div className="flex flex-col items-center mt-0">
          <div className={stepStyles(2)}>
            {step > 2 ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                stroke="currentColor"
                className="w-5 h-5 text-white transform scale-100 transition-transform duration-300 ease-out"
              >
                <path
                  d="M4 12.6111L8.92308 17.5L20 6.5"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : step === 2 ? (
              <div className="w-3.5 h-3.5 rounded-full bg-orange-500 transition-all duration-300 ease-in-out"></div>
            ) : null}
          </div>
          <span className={`text-sm mt-2 text-center ${step >= 2 ? "text-orange-500 font-medium" : "text-gray-400"}`}>
            Productos
          </span>
        </div>
      </div>

      {/* Formulario */}
      <div>
        {step === 1 && (
          <div className="text-black grid grid-cols-6 gap-4 rounded-lg shadow-lg p-4 mt-3">
            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4 ">Nombre Completo</label>
              <input
                type="text"
                name="nombre"
                value={formData.nombre}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black"
                placeholder="Ingrese el nombre completo"
              />
              {errors.nombre && <p className="text-red-500 text-sm ml-4">{errors.nombre}</p>}
            </div>

            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4 ">Referencia 1</label>
              <input
                type="text"
                name="referencia"
                value={formData.referencia}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black"
                placeholder="Ingrese la referencia del cliente"
              />
              {errors.referencia && <p className="text-red-500 text-sm ml-4">{errors.referencia}</p>}
            </div>

            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4 ">Referencia 2</label>
              <input
                type="text"
                name="referencia2"
                value={formData.referencia2}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black"
                placeholder="Ingrese la segunda referencia (opcional)"
              />
              {errors.referencia2 && <p className="text-red-500 text-sm ml-4">{errors.referencia2}</p>}
            </div>

            <div className="col-span-4 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4">Nombre Usuario</label>
              <div className="flex">
                <input
                  type="text"
                  name="email"
                  value={formData.email.replace("@ingenial-ia.com", "")}
                  onChange={(e) => {
                    let username = e.target.value;
                    username = username.replace(/[^a-zA-Z0-9._-]/g, "");
                    setFormData({ ...formData, email: `${username}@ingenial-ia.com` });
                    if (errors['email']) {
                      setErrors((prev) => ({
                        ...prev,
                        ['email']: "",
                      }));
                    }
                  }}
                  className="flex-grow p-2 bg-[#fef1e9] border border-gray-300 rounded-l-md text-black"
                  placeholder="Usuario"
                />
                <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-gray-300 bg-gray-100 text-gray-700 text-sm whitespace-nowrap">
                  @ingenial-ia.com
                </span>
              </div>
              {errors.email && <p className="text-red-500 text-sm ml-4">{errors.email}</p>}
            </div>

            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4">Correo Personal</label>
              <input
                type="email"
                name="personalEmail"
                value={formData.personalEmail}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black"
                placeholder="correo@ejemplo.com"
              />
              {errors.personalEmail && <p className="text-red-500 text-sm ml-4">{errors.personalEmail}</p>}
            </div>

            <div className="col-span-2 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4">Teléfono</label>
              <input
                type="tel"
                name="telefono"
                value={formData.telefono}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black"
                placeholder="+57 321456789"
              />
              {errors.telefono && <p className="text-red-500 text-sm ml-4">{errors.telefono}</p>}
            </div>

            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4">Tipo de persona</label>
              <select
                name="tipoPersona"
                value={formData.tipoPersona}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] text-black border border-gray-300 rounded-md"
              >
                <option value="" disabled>Seleccione un tipo</option>
                <option value="Persona Natural">Persona Natural</option>
                <option value="Persona Jurídica">Persona Jurídica</option>
              </select>
              {errors.tipoPersona && <p className="text-red-500 text-sm ml-4">{errors.tipoPersona}</p>}
            </div>

            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4">Tipo de DNI</label>
              <select
                name="tipoDNI"
                value={formData.tipoDNI}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] text-black border border-gray-300 rounded-md"
              >
                <option value="" disabled>Seleccione un tipo</option>
                <option value="Cédula de Ciudadanía">Cédula de Ciudadanía</option>
                <option value="NIT">NIT</option>
              </select>
              {errors.tipoDNI && <p className="text-red-500 text-sm ml-4">{errors.tipoDNI}</p>}
            </div>

            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4">DNI</label>
              <input
                type="tel"
                name="numeroDNI"
                value={formData.numeroDNI}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black"
                placeholder="000 000 000"
              />
              {errors.numeroDNI && <p className="text-red-500 text-sm ml-4">{errors.numeroDNI}</p>}
            </div>

            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4">Tipo de usuario</label>
              <select
                name="tipoUsuario"
                value={formData.tipoUsuario}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] text-black border border-gray-300 rounded-md"
              >
                <option value="" disabled >Seleccione un tipo</option>
                <option value="User">Cliente</option>
                <option value="Admin">Administrador</option>
              </select>
              {errors.tipoUsuario && <p className="text-red-500 text-sm ml-4">{errors.tipoUsuario}</p>}
            </div>

            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4">Contraseña</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black"
                placeholder="********"
              />
              {errors.password && <p className="text-red-500 text-sm ml-4">{errors.password}</p>}
            </div>

            <div className="col-span-3 mr-5 ml-5 mb-3">
              <label className="block text-black font-bold mb-2 ml-4">Confirme su contraseña</label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black"
                placeholder="********"
              />
              {errors.confirmPassword && <p className="text-red-500 text-sm ml-4">{errors.confirmPassword}</p>}
            </div>
          </div>
        )}

        {step === 2 && (
          <ProductsSelector
            votometroZones={votometroZones}
            setVotometroZones={setVotometroZones}
            audivotoZones={audivotoZones}
            setAudivotoZones={setAudivotoZones}
            votometroEnabled={votometroEnabled}
            setVotometroEnabled={setVotometroEnabled}
            audivotoEnabled={audivotoEnabled}
            setAudivotoEnabled={setAudivotoEnabled}
            formData={productsFormData}
            setFormData={setProductsFormData}
            errors={productsErrors}
            setErrors={setProductsErrors}
            departamentos={departamentos}
            municipios={municipios}
          />
        )}

        <div className="flex justify-between items-center mr-5 mt-5">
          {step > 1 ? (
            <button
              type="button"
              onClick={prevStep}
              className="btn bg-white text-[#0b1f3a] text-md hover:bg-gray-100 rounded-lg px-6 w-1/7"
            >
              Atrás
            </button>
          ) : (
            <span></span>
          )}
          {step < 2 ? (
            <button
              type="button"
              onClick={nextStep}
              className="btn bg-[#0b1f3a] text-white text-md hover:bg-[#132d52] rounded-lg px-6 shadow-md mr-5"
            >
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="btn bg-[#0b1f3a] text-white text-md hover:bg-[#132d52] rounded-lg px-6 shadow-md mr-5"

            >
              {loading ? 'Guardando...' : 'Registrar Usuario'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default RegisterUser;
