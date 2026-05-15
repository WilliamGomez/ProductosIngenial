import { getDepartments, getMunicipalities, updateUserInfo, updateUserproducts, type IUserZone } from "../services/api";
import type { IProductsFormData, IUserInfoFormData } from "../interfaces/IRegisterUserFormData";
import type { IDepartment } from "../interfaces/IDepartments";
import type { IMunicipio } from "../interfaces/IMunicipio";
import { useAccessToken } from "../hooks/useAccessToken";
import React, { useEffect, useState } from "react";
import ProductsSelector from "./ProductsSelector";
import type { IUser } from "../interfaces/IUser";

interface RegisterUserProps {
  onSuccess: () => void;
  selectedUser: IUser;
}

const initialFormData: IUserInfoFormData = {
  display_name: "",
  phone: "",
  email: "",
  personal_email: "",
  reference: "",
  reference2: "",
  identity_document: "",
  type_person: "",
  type_dni: "",
  role: "",
  enable: false,
};

const padDep = (value: string | number) => String(value).padStart(2, "0");
const toUiZoneCode = (codDep: string | number, codMun: string | number | null) => {
  if (codMun == null) return null;
  const raw = String(codMun).trim();
  return raw.length <= 3 ? `${padDep(codDep)}${raw.padStart(3, "0")}` : raw.padStart(5, "0");
};
const toBackendZones = (zones: IUserZone[]): IUserZone[] =>
  zones.map((zone) => ({
    cod_dep: padDep(zone.cod_dep),
    cod_mun: zone.cod_mun == null ? null : String(zone.cod_mun).slice(-3).padStart(3, "0"),
  }));
const fromBackendZones = (zones?: IUserZone[]): IUserZone[] =>
  (zones ?? []).map((zone) => ({
    ...zone,
    cod_dep: padDep(zone.cod_dep),
    cod_mun: toUiZoneCode(zone.cod_dep, zone.cod_mun),
  }));

const UpdateUser = ({ onSuccess, selectedUser }: RegisterUserProps) => {
  const { getToken } = useAccessToken();
  const [productsErrors, setProductsErrors] = useState<{ [key: string]: string }>({});
  const [errors, setErrors] = useState<Partial<IUserInfoFormData>>({});

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeTab, setActiveTab] = useState<"personal" | "products">("personal");

  const [formData, setFormData] = useState<IUserInfoFormData>(initialFormData);

  const [departamentos, setDepartamentos] = useState<IDepartment[]>([]);
  const [municipios, setMunicipios] = useState<IMunicipio[]>([]);

  const [votometroZones, setVotometroZones] = useState<IUserZone[]>([]);
  const [audivotoZones, setAudivotoZones] = useState<IUserZone[]>([]);

  const [votometroEnabled, setVotometroEnabled] = useState<boolean>(() => {
    const votometro = selectedUser.products.find((p) => p.name === "Votometro");
    return votometro ? votometro.enable !== false : false;
  });
  const [audivotoEnabled, setAudivotoEnabled] = useState<boolean>(() => {
    const audivoto = selectedUser.products.find((p) => p.name === "Audivoto");
    return audivoto ? audivoto.enable !== false : false;
  });

  let votometroUnit = "";
  let audivotoUnit = "";

  const enabledProductsForUnit = selectedUser.products.filter((p) => p.enable !== false);
  const votometroProductForUnit = enabledProductsForUnit.find((p) => p.name === "Votometro");
  const audivotoProductForUnit = enabledProductsForUnit.find((p) => p.name === "Audivoto");

  if (votometroProductForUnit && votometroProductForUnit.duration_unit !== undefined) {
    const duration = votometroProductForUnit.contract_duration;
    const unit = votometroProductForUnit.duration_unit;
    votometroUnit =
      unit === "months"
        ? duration === 1 ? " mes" : " meses"
        : unit === "years"
          ? duration === 1 ? " año" : " años"
          : unit === "hours"
            ? duration === 1 ? " hora" : " horas"
            : duration === 1 ? " día" : " días";
  }

  if (audivotoProductForUnit && audivotoProductForUnit.duration_unit !== undefined) {
    const duration = audivotoProductForUnit.contract_duration;
    const unit = audivotoProductForUnit.duration_unit;
    audivotoUnit =
      unit === "months"
        ? duration === 1 ? " mes" : " meses"
        : unit === "years"
          ? duration === 1 ? " año" : " años"
          : unit === "hours"
            ? duration === 1 ? " hora" : " horas"
            : duration === 1 ? " día" : " días";
  }

  const [productsFormData, setProductsFormData] = useState<IProductsFormData>(() => {
    const enabledProducts = selectedUser.products.filter((p) => p.enable !== false);
    const votometroProduct = enabledProducts.find((p) => p.name === "Votometro");
    const audivotoProduct = enabledProducts.find((p) => p.name === "Audivoto");

    return {
      tiempoContratacionVotometro:
        votometroProduct && votometroProduct.contract_duration != null ? String(votometroProduct.contract_duration) + votometroUnit : "",
      tiempoContratacionAudivoto:
        audivotoProduct && audivotoProduct.contract_duration != null ? String(audivotoProduct.contract_duration) + audivotoUnit : "",
      initialProducts: enabledProducts,
      newProducts: enabledProducts,
    };
  });

  useEffect(() => {
    if (selectedUser) {
      setFormData((prev) => ({
        ...prev,
        display_name: selectedUser.display_name || "",
        email: selectedUser.email || "",
        personal_email: selectedUser.personal_email || "",
        phone: selectedUser.phone || "",
        reference: selectedUser.reference || "",
        reference2: selectedUser.reference2 || "",
        identity_document: selectedUser.identity_document || "0",
        type_person: selectedUser.type_person || "",
        type_dni: selectedUser.type_dni || "",
        role: selectedUser.role || "",
        enable: selectedUser.enable || false,
      }));

      const enabledProducts = selectedUser.products.filter((p) => p.enable !== false);
      setVotometroZones(fromBackendZones(enabledProducts.find((p) => p.name === "Votometro")?.zones));
      setAudivotoZones(fromBackendZones(enabledProducts.find((p) => p.name === "Audivoto")?.zones));
    }
  }, [selectedUser]);

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

  const validateProducts = (): boolean => {
    const hasAtLeastOne = votometroEnabled || audivotoEnabled;

    if (!hasAtLeastOne) {
      setProductsErrors((prev) => ({
        ...prev,
        general: "Debe habilitar al menos un producto:\nVotómetro o Audivoto.",
      }));
      return false;
    }
    setProductsErrors((prev) => ({ ...prev, general: "" }));

    const votometroValid = votometroEnabled ? validateVotometro() : true;
    const audivotoValid = audivotoEnabled ? validateAudivoto() : true;

    return votometroValid && audivotoValid;
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

  const validateForm = () => {
    const errors: Partial<IUserInfoFormData> = {};

    if (!formData.display_name.trim()) errors.display_name = "El nombre completo es requerido.";

    if (!formData.email.trim()) {
      errors.email = "El email es requerido.";
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errors.email = "El email no es válido.";
    }

    if (!formData.phone.trim()) {
      errors.phone = "El teléfono es requerido.";
    } else if (!/^\+?\d{7,15}$/.test(formData.phone)) {
      errors.phone = "Formato de teléfono inválido.";
    }

    if (!formData.identity_document.trim()) {
      errors.identity_document = "El número de documento es requerido.";
    } else if (Number(formData.identity_document) < 10000000) {
      errors.identity_document = "El número debe ser mayor a 10 millones";
    } else {
      const numeroStr = formData.identity_document.toString();

      if (formData.type_person === "Persona Natural") {
        if (numeroStr.length < 6 || numeroStr.length > 10) {
          errors.identity_document = "La cédula debe tener entre 6 y 10 dígitos.";
        }
      } else if (formData.type_person === "Persona Jurídica") {
        if (numeroStr.length < 9 || numeroStr.length > 10) {
          errors.identity_document = "El NIT debe tener entre 9 y 10 dígitos.";
        }
      } else {
        if (numeroStr.length < 5 || numeroStr.length > 10) {
          errors.identity_document = "Formato de número de documento inválido.";
        }
      }
    }

    if (!formData.reference.trim()) errors.reference = "La referencia es requerida.";
    if (!formData.type_person.trim()) errors.type_person = "Debe seleccionar un tipo de persona.";
    if (!formData.role.trim()) errors.role = "Debe seleccionar un tipo de usuario.";
    if (!formData.type_dni.trim()) errors.type_dni = "Debe seleccionar un tipo de DNI.";

    return errors;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    var formattedValue = e.target.value;

    if (e.target.name == "phone") {
      formattedValue = e.target.value.replace(/[^0-9]/g, "");
    }

    if (e.target.name == "enable") {
      if (formattedValue == "1") {
        setFormData({ ...formData, [e.target.name]: true });
      } else if (e.target.value == "0") {
        setFormData({ ...formData, [e.target.name]: false });
      }
    } else {
      setFormData({ ...formData, [e.target.name]: formattedValue });
    }
  };

  const handleCancelLoading = () => {
    setLoading(false);
  };

  const handleSubmitPersonal = async () => {
    const currentErrors = validateForm();

    if (Object.keys(currentErrors).length > 0) {
      setErrors(currentErrors);
      return;
    }

    setErrors({});
    setLoading(true);

    const body = {
      display_name: formData.display_name,
      phone: formData.phone,
      email: formData.email,
      personal_email: formData.personal_email,
      reference: formData.reference,
      reference2: formData.reference2,
      identity_document: formData.identity_document,
      type_person: formData.type_person,
      type_dni: formData.type_dni,
      role: formData.role,
      enable: formData.enable,
    };

    try {
      const token = await getToken();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado')), 30000)
      );

      await Promise.race([
        updateUserInfo(token, selectedUser.id, body),
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
      console.error("Error al actualizar usuario:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitProducts = async (e: React.FormEvent<HTMLButtonElement>) => {
    e.preventDefault();

    if (!validateProducts()) return;

    setLoading(true);

    try {
      const token = await getToken();

      // Construir array de productos CON sus zonas anidadas
      const productsToSend: Array<{
        id?: number | null;
        name: string;
        contract_duration: number;
        duration_unit: string;
        enable: boolean;
        amount_cop: number;
        zones: Array<{ cod_dep: string; cod_mun: string | null }>;
      }> = [];

      // Votometro
      if (votometroEnabled) {
        const votometroProduct = selectedUser.products.find((p) => p.name === "Votometro");
        const votometroProductId = votometroProduct?.id;
        const durationMatch = productsFormData.tiempoContratacionVotometro.match(/(\d+)/);
        const duration = durationMatch ? parseInt(durationMatch[1]) : 1;

        productsToSend.push({
          id: votometroProductId || null,
          name: "Votometro",
          contract_duration: duration,
          duration_unit: productsFormData.tiempoContratacionVotometro.includes("mes")
            ? "months"
            : productsFormData.tiempoContratacionVotometro.includes("año")
              ? "years"
              : productsFormData.tiempoContratacionVotometro.includes("hora")
                ? "hours"
                : "days",
          enable: true,
          amount_cop: 150000,
          zones: toBackendZones(votometroZones),
        });
      }

      // Audivoto
      if (audivotoEnabled) {
        const audivotoProduct = selectedUser.products.find((p) => p.name === "Audivoto");
        const audivotoProductId = audivotoProduct?.id;
        const durationMatch = productsFormData.tiempoContratacionAudivoto.match(/(\d+)/);
        const duration = durationMatch ? parseInt(durationMatch[1]) : 1;

        productsToSend.push({
          id: audivotoProductId || null,
          name: "Audivoto",
          contract_duration: duration,
          duration_unit: productsFormData.tiempoContratacionAudivoto.includes("mes")
            ? "months"
            : productsFormData.tiempoContratacionAudivoto.includes("año")
              ? "years"
              : productsFormData.tiempoContratacionAudivoto.includes("hora")
                ? "hours"
                : "days",
          enable: true,
          amount_cop: 150000,
          zones: toBackendZones(audivotoZones),
        });
      }

      // Enviar productos CON zonas al backend
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado')), 30000)
      );

      await Promise.race([
        updateUserproducts(token, selectedUser.id, productsToSend),
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
      console.error("Error al guardar productos:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='bg-white p-8'>
      {loading && (
        <div className='fixed inset-0 bg-opacity-10 backdrop-blur-xs z-50 flex flex-col items-center justify-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-t-4 border-orange-500 border-b-4'></div>
          <p className='mt-4 text-orange-600 text-sm font-semibold'>Guardando...</p>
          <button
            onClick={handleCancelLoading}
            className='mt-4 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 underline'
          >
            Cancelar
          </button>
        </div>
      )}

      {success && (
        <div className='fixed inset-0 bg-white bg-opacity-80 z-50 flex flex-col items-center justify-center'>
          <svg className='w-16 h-16 text-green-500 mb-4' fill='none' stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'>
            <path strokeLinecap='round' strokeLinejoin='round' d='M5 13l4 4L19 7' />
          </svg>
          <p className='text-green-600 text-lg font-semibold'>¡Usuario actualizado con éxito!</p>
          <p className='text-gray-500 text-sm mt-2'>Volviendo al panel de actualización...</p>
        </div>
      )}

      {failed && (
        <div className='fixed inset-0 bg-white bg-opacity-80 z-50 flex flex-col items-center justify-center'>
          <svg className='w-16 h-16 text-red-500 mb-4' fill='none' stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'>
            <path strokeLinecap='round' strokeLinejoin='round' d='M6 18L18 6M6 6l12 12' />
          </svg>
          <p className='text-red-600 text-lg font-semibold'>No se pudo actualizar la información</p>
          <p className='text-gray-500 text-sm mt-2'>Por favor, verifica los datos o intenta de nuevo más tarde.</p>
        </div>
      )}

      <div className='flex space-x-4 mb-2 border-b border-gray-200'>
        <button
          className={`py-1 px-4 font-semibold ${activeTab === "personal" ? "border-b-2 border-orange-500 text-orange-600" : "text-gray-500"}`}
          onClick={() => setActiveTab("personal")}
        >
          Información Personal
        </button>
        <button
          className={`py-1 px-4 font-semibold ${activeTab === "products" ? "border-b-2 border-orange-500 text-orange-600" : "text-gray-500"}`}
          onClick={() => setActiveTab("products")}
        >
          Productos
        </button>
      </div>

      {activeTab === "personal" && (
        <div>
          <div className='text-black grid grid-cols-10 gap-4 rounded-lg shadow-lg p-4'>
            <div className='col-span-10 mr-5 ml-5 mb-3'>
              <div className='flex flex-col items-center justify-center'>
                <label className='block text-black font-bold mb-2'>Nombre Usuario</label>
                <span className='px-4 py-3 rounded-md border border-gray-300 bg-gray-100 text-gray-700 text-sm text-center w-fit'>
                  {formData.email}
                </span>
              </div>
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4 '>Nombre Completo</label>
              <input
                type='text'
                name='display_name'
                value={formData.display_name}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                placeholder='Ingrese el nuevo nombre'
              />
              {errors.display_name && <p className='text-red-500 text-sm ml-4'>{errors.display_name}</p>}
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4 '>Referencia 1</label>
              <input
                type='text'
                name='reference'
                value={formData.reference}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                placeholder='Ingrese la nueva referencia'
              />
              {errors.reference && <p className='text-red-500 text-sm ml-4'>{errors.reference}</p>}
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4 '>Referencia 2</label>
              <input
                type='text'
                name='reference2'
                value={formData.reference2}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                placeholder='Ingrese la segunda referencia (opcional)'
              />
              {errors.reference2 && <p className='text-red-500 text-sm ml-4'>{errors.reference2}</p>}
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4'>Correo Personal</label>
              <input
                type='email'
                name='personal_email'
                value={formData.personal_email}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                placeholder='correo@ejemplo.com'
              />
              {errors.personal_email && <p className='text-red-500 text-sm ml-4'>{errors.personal_email}</p>}
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4'>Teléfono</label>
              <input
                type='tel'
                name='phone'
                value={formData.phone}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                placeholder='+57 321456789'
              />
              {errors.phone && <p className='text-red-500 text-sm ml-4'>{errors.phone}</p>}
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4'>Tipo de persona</label>
              <select
                name='type_person'
                value={formData.type_person}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] text-black border border-gray-300 rounded-md'
              >
                <option value='' disabled>
                  Seleccione un tipo
                </option>
                <option value='Persona Natural'>Persona Natural</option>
                <option value='Persona Jurídica'>Persona Jurídica</option>
              </select>
              {errors.type_person && <p className='text-red-500 text-sm ml-4'>{errors.type_person}</p>}
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4'>Tipo de DNI</label>
              <select
                name='type_dni'
                value={formData.type_dni}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] text-black border border-gray-300 rounded-md'
              >
                <option value='' disabled>
                  Seleccione un tipo
                </option>
                <option value='Cédula de Ciudadanía'>Cédula de Ciudadanía</option>
                <option value='NIT'>NIT</option>
              </select>
              {errors.type_dni && <p className='text-red-500 text-sm ml-4'>{errors.type_dni}</p>}
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4'>DNI</label>
              <input
                type='tel'
                name='identity_document'
                value={formData.identity_document}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                placeholder='000 000 000'
              />
              {errors.identity_document && <p className='text-red-500 text-sm ml-4'>{errors.identity_document}</p>}
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4'>Estado</label>
              <select
                name='enable'
                value={formData.enable ? "1" : "0"}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] text-black border border-gray-300 rounded-md'
              >
                <option value='' disabled>
                  Seleccione un estado
                </option>
                <option value='1'>Activo</option>
                <option value='0'>Inactivo</option>
              </select>
              {errors.enable && <p className='text-red-500 text-sm ml-4'>{errors.enable}</p>}
            </div>

            <div className='col-span-5 mr-5 ml-5 mb-3'>
              <label className='block text-black font-bold mb-2 ml-4'>Tipo de usuario</label>
              <select
                name='role'
                value={formData.role}
                onChange={handleChange}
                className='w-full p-2 bg-[#fef1e9] text-black border border-gray-300 rounded-md'
              >
                <option value='' disabled>
                  Seleccione un tipo
                </option>
                <option value='User'>Cliente</option>
                <option value='Admin'>Administrador</option>
              </select>
              {errors.role && <p className='text-red-500 text-sm ml-4'>{errors.role}</p>}
            </div>
          </div>

          <div className='flex justify-end mr-5 mt-8'>
            <button onClick={handleSubmitPersonal} className='bg-orange-500 text-white py-2 px-3 rounded hover:bg-orange-600'>
              Guardar Información Personal
            </button>
          </div>
        </div>
      )}

      {activeTab === "products" && (
        <div className='p-4 rounded-lg shadow-lg'>
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

          <div className='flex justify-end mr-5 mt-8'>
            <button onClick={(e) => handleSubmitProducts(e)} className='bg-orange-500 text-white py-2 px-3 rounded hover:bg-orange-600'>
              Guardar Productos
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdateUser;
