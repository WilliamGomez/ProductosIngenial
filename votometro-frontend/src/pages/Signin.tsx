import { useState } from "react";

const Signin = () => {
  const [step, setStep] = useState(1);
  const [producto, setProducto] = useState("votometro");

  const [formData, setFormData] = useState({
    nombre: "",
    apellido: "",
    email: "",
    telefono: "",
    password: "",
    confirmPassword: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const nextStep = () => {
    if (step < 3) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
  };

  const stepStyles = (index: number) =>
    `w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
      step === index ? "border-orange-500" : step > index ? "bg-orange-500 border-orange-500 text-white" : "border-gray-300 bg-white"
    }`;

  return (
    <div className='min-h-screen flex overflow-hidden'>
      <div className='w-3/5 bg-white p-10'>
        <h2 className='text-4xl font-bold text-center text-[#0b1f3a] mb-10 mt-10'>Registrarme</h2>

        {/* Pasos */}
        <div className='flex items-center justify-between max-w-md mx-auto mb-20'>
          {/* Paso 1 */}
          <div className='flex flex-col items-center mt-10'>
            <div className={stepStyles(1)}>
              {step > 1 ? (
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                  stroke='currentColor'
                  className='w-5 h-5 text-white transform scale-100 transition-transform duration-300 ease-out'
                >
                  <path d='M4 12.6111L8.92308 17.5L20 6.5' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
                </svg>
              ) : step === 1 ? (
                <div className='w-3.5 h-3.5 rounded-full bg-orange-500 transition-all duration-300 ease-in-out'></div>
              ) : null}
            </div>
            <span className='text-sm mt-2 text-orange-500 font-medium text-center'>
              Información <br /> Personal
            </span>
          </div>

          <div className='relative w-1/4 h-0.5 mt-0 mb-3 bg-gray-300 overflow-hidden'>
            <div
              className={`absolute top-0 left-0 h-full bg-orange-500 origin-left transition-transform duration-500 ease-in-out ${
                step > 1 ? "scale-x-100" : "scale-x-0"
              }`}
              style={{ width: "100%" }}
            />
          </div>

          {/* Paso 2 */}
          <div className='flex flex-col items-center mt-5'>
            <div className={stepStyles(2)}>
              {step > 2 ? (
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                  stroke='currentColor'
                  className='w-5 h-5 text-white transform scale-100 transition-transform duration-300 ease-out'
                >
                  <path d='M4 12.6111L8.92308 17.5L20 6.5' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
                </svg>
              ) : step === 2 ? (
                <div className='w-3.5 h-3.5 rounded-full bg-orange-500 transition-all duration-300 ease-in-out'></div>
              ) : null}
            </div>
            <span className={`text-sm mt-2 text-center ${step >= 2 ? "text-orange-500 font-medium" : "text-gray-400"}`}>Productos</span>
          </div>

          <div className='relative w-1/4 h-0.5 mt-0 mb-3 bg-gray-300 overflow-hidden'>
            <div
              className={`absolute top-0 left-0 h-full bg-orange-500 origin-left transition-transform duration-500 ease-in-out ${
                step > 2 ? "scale-x-100" : "scale-x-0"
              }`}
              style={{ width: "100%" }}
            />
          </div>

          {/* Paso 3 */}
          <div className='flex flex-col items-center mt-5'>
            <div className={stepStyles(3)}>
              {step > 3 ? (
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                  stroke='currentColor'
                  className='w-5 h-5 text-white transform scale-100 transition-transform duration-300 ease-out'
                >
                  <path d='M4 12.6111L8.92308 17.5L20 6.5' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' />
                </svg>
              ) : step === 3 ? (
                <div className='w-3.5 h-3.5 rounded-full bg-orange-500 transition-all duration-300 ease-in-out'></div>
              ) : null}
            </div>
            <span className={`text-sm mt-2 text-center ${step >= 3 ? "text-orange-500 font-medium" : "text-gray-400"}`}>Pago</span>
          </div>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit}>
          {step === 1 && (
            <div className='grid grid-cols-2 gap-4 rounded-lg shadow-lg p-5'>
              <div className='mr-5 ml-5 mb-5'>
                <label className='block text-black font-bold mb-2 ml-4 '>Nombre</label>
                <input
                  type='text'
                  name='nombre'
                  value={formData.nombre}
                  onChange={handleChange}
                  className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                  placeholder='Ingrese su nombre'
                  required
                />
              </div>

              <div className='mr-5 ml-5 mb-5'>
                <label className='block text-black font-bold mb-2 ml-4'>Apellido</label>
                <input
                  type='text'
                  name='apellido'
                  value={formData.apellido}
                  onChange={handleChange}
                  className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                  placeholder='Ingrese su apellido'
                  required
                />
              </div>

              <div className='mr-5 ml-5 mb-5'>
                <label className='block text-black font-bold mb-2 ml-4'>Email</label>
                <input
                  type='email'
                  name='email'
                  value={formData.email}
                  onChange={handleChange}
                  className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                  placeholder='info@ingenialai.com'
                  required
                />
              </div>

              <div className='mr-5 ml-5 mb-5'>
                <label className='block text-black font-bold mb-2 ml-4'>Teléfono</label>
                <input
                  type='tel'
                  name='telefono'
                  value={formData.telefono}
                  onChange={handleChange}
                  className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                  placeholder='+91 - 98596 58000'
                />
              </div>

              <div className='mr-5 ml-5 mb-5'>
                <label className='block text-black font-bold mb-2 ml-4'>Contraseña</label>
                <input
                  type='password'
                  name='password'
                  value={formData.password}
                  onChange={handleChange}
                  className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                  placeholder='********'
                  required
                />
              </div>

              <div className='mr-5 ml-5 mb-5'>
                <label className='block text-black font-bold mb-2 ml-4'>Confirme su contraseña</label>
                <input
                  type='password'
                  name='confirmPassword'
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className='w-full p-2 bg-[#fef1e9] placeholder-gray-500 border border-gray-300 rounded-md text-black'
                  placeholder='********'
                  required
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className='flex justify-between p-8 bg-white rounded-lg shadow-lg w-full max-w-4xl mx-auto'>
              {/* Sección de selección */}
              <div className='w-1/2 space-y-6'>
                {/* Tabs de productos */}
                <div className='flex space-x-4'>
                  <button
                    onClick={() => setProducto("votometro")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md font-semibold ${
                      producto === "votometro" ? "bg-orange-500 text-white" : "border border-orange-500 text-orange-500"
                    }`}
                  >
                    <svg width='44' height='44' viewBox='0 0 44 44' fill='none' xmlns='http://www.w3.org/2000/svg'>
                      <path
                        d='M17.7375 22.726L21.6838 26.6695C22.0816 27.104 22.5912 27.3213 23.2127 27.3213C23.8324 27.3213 24.3586 27.104 24.7913 26.6695L34.375 17.1407V22.0687C34.375 22.4244 34.5061 22.7315 34.7682 22.99C35.0304 23.2467 35.3577 23.375 35.75 23.375C36.1057 23.375 36.4238 23.2439 36.7043 22.9818C36.9847 22.7196 37.125 22.3923 37.125 22V14.597C37.125 13.992 36.905 13.4713 36.465 13.035C36.0268 12.595 35.5062 12.375 34.903 12.375H27.4313C27.0756 12.375 26.7694 12.5152 26.5127 12.7957C26.2561 13.0763 26.1268 13.3943 26.125 13.75C26.125 14.1423 26.2561 14.4696 26.5182 14.7318C26.7804 14.9939 27.1077 15.125 27.5 15.125H32.3592L23.2375 24.3705L19.294 20.4242C18.8595 19.9806 18.3324 19.7588 17.7127 19.7588C17.0912 19.7588 16.5816 19.9806 16.1838 20.4242L8.3765 28.1792C8.10883 28.4707 7.975 28.8035 7.975 29.1775C7.975 29.5515 8.10883 29.8668 8.3765 30.1235C8.66983 30.426 9.0035 30.5773 9.3775 30.5773C9.7515 30.5773 10.0668 30.426 10.3235 30.1235L17.7375 22.726ZM4.444 44C3.17717 44 2.12025 43.5765 1.27325 42.7295C0.42625 41.8825 0.00183333 40.8247 0 39.556V4.444C0 3.17717 0.424416 2.12025 1.27325 1.27325C2.12208 0.42625 3.179 0.00183333 4.444 0H39.5588C40.8237 0 41.8807 0.424416 42.7295 1.27325C43.5783 2.12208 44.0018 3.179 44 4.444V39.5588C44 40.8237 43.5765 41.8807 42.7295 42.7295C41.8825 43.5783 40.8247 44.0018 39.556 44H4.444Z'
                        fill='white'
                      />
                    </svg>{" "}
                    Votómetro
                  </button>
                  <button
                    onClick={() => setProducto("audivoto")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md font-semibold ${
                      producto === "audivoto" ? "bg-orange-500 text-white" : "border border-orange-500 text-orange-500"
                    }`}
                  >
                    <svg width='43' height='47' viewBox='0 0 43 47' fill='none' xmlns='http://www.w3.org/2000/svg'>
                      <g filter='url(#filter0_d_51_440)'>
                        <path
                          d='M34.0417 17.7084V15.9167C34.0417 9.16033 34.0417 5.78125 31.9418 3.68321C29.842 1.58517 26.4647 1.58337 19.7083 1.58337C12.952 1.58337 9.57287 1.58337 7.47483 3.68321C5.37679 5.78304 5.375 9.16033 5.375 15.9167V23.0834C5.375 29.8397 5.375 33.2188 7.47483 35.3169C9.57467 37.4149 12.952 37.4167 19.7083 37.4167'
                          stroke='#EF7E1B'
                          stroke-width='1.5'
                          stroke-linecap='round'
                          stroke-linejoin='round'
                        />
                        <path
                          d='M37.6251 37.4167L34.5542 34.3458M12.5417 10.5417H26.8751M12.5417 17.7084H19.7084M35.5772 29.227C35.5911 30.0425 35.4425 30.8527 35.1401 31.6101C34.8376 32.3676 34.3874 33.0573 33.8156 33.6389C33.2438 34.2205 32.5619 34.6825 31.8098 34.9978C31.0576 35.3132 30.2501 35.4756 29.4345 35.4756C28.6189 35.4756 27.8114 35.3132 27.0592 34.9978C26.307 34.6825 25.6251 34.2205 25.0533 33.6389C24.4816 33.0573 24.0313 32.3676 23.7289 31.6101C23.4264 30.8527 23.2778 30.0425 23.2917 29.227C23.3193 27.6161 23.9785 26.0804 25.1275 24.9508C26.2765 23.8213 27.8233 23.1883 29.4345 23.1883C31.0457 23.1883 32.5924 23.8213 33.7414 24.9508C34.8904 26.0804 35.5497 27.6161 35.5772 29.227Z'
                          stroke='#EF7E1B'
                          stroke-width='1.5'
                          stroke-linecap='round'
                          stroke-linejoin='round'
                        />
                      </g>
                      <defs>
                        <filter
                          id='filter0_d_51_440'
                          x='0.625'
                          y='0.833374'
                          width='41.75'
                          height='45.3334'
                          filterUnits='userSpaceOnUse'
                          color-interpolation-filters='sRGB'
                        >
                          <feFlood flood-opacity='0' result='BackgroundImageFix' />
                          <feColorMatrix in='SourceAlpha' type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0' result='hardAlpha' />
                          <feOffset dy='4' />
                          <feGaussianBlur stdDeviation='2' />
                          <feComposite in2='hardAlpha' operator='out' />
                          <feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0' />
                          <feBlend mode='normal' in2='BackgroundImageFix' result='effect1_dropShadow_51_440' />
                          <feBlend mode='normal' in='SourceGraphic' in2='effect1_dropShadow_51_440' result='shape' />
                        </filter>
                      </defs>
                    </svg>{" "}
                    Audivoto
                  </button>
                </div>

                {/* Formulario de selección */}
                <div className='space-y-4'>
                  {["País", "Departamento", "Municipio", "Tiempo de contratación"].map((label, index) => (
                    <div key={index}>
                      <label className='block text-sm font-medium text-gray-700 mb-1'>{label}</label>
                      <div className='relative'>
                        <select className='w-full appearance-none px-4 py-2 pr-10 bg-[#FEF3EC] border border-[#FEF3EC] text-gray-700 rounded-md focus:outline-none'>
                          <option>
                            {label === "País" ? "Colombia" : label === "Departamento" ? "Antioquia" : label === "Municipio" ? "Medellín" : "1 mes"}
                          </option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Panel de resumen */}
              <div className='w-[45%]'>
                <h3 className='text-right font-medium text-gray-700 mb-2'>Total a pagar</h3>
                <div className='bg-[#FEF3EC] p-4 rounded-md text-sm text-gray-800'>
                  <div className='flex justify-between mb-1'>
                    <span>Votómetro MEDELLIN (1 mes)</span>
                    <span>USD 5.000</span>
                  </div>
                  <div className='flex justify-between mb-1'>
                    <span>Audivoto (3 meses)</span>
                    <span>USD 7.500</span>
                  </div>
                  <hr className='my-2 border-gray-300' />
                  <div className='flex justify-between font-semibold text-black'>
                    <span>TOTAL</span>
                    <span>USD 12.500</span>
                  </div>
                </div>

                <button className='w-full mt-6 bg-[#0B1F3A] text-white font-semibold py-2 rounded-md shadow-md hover:bg-[#0a1830] transition'>
                  Confirmar y pagar
                </button>
              </div>
            </div>
          )}

          {step === 3 && <div className='text-center py-20 text-gray-400'>Paso 3 - Pago</div>}

          <div className='mt-10 flex justify-between items-center mr-5 mt-20'>
            {step > 1 ? (
              <button type='button' onClick={prevStep} className='btn bg-white text-[#0b1f3a] text-md hover:bg-gray-100 rounded-lg px-6 w-1/7'>
                Atrás
              </button>
            ) : (
              <span></span>
            )}
            {step < 3 ? (
              <button
                type='button'
                onClick={nextStep}
                className='btn bg-[#0b1f3a] text-white text-md hover:bg-[#132d52] rounded-lg px-6 shadow-md mr-5'
              >
                Siguiente
              </button>
            ) : (
              <button type='submit' className='px-6 py-2 rounded text-white bg-[#0b1f3a] shadow-md'>
                Registrarme
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Lado derecho */}
      <div
        className='w-2/5 bg-[#0b1f3a] flex flex-col items-center justify-center text-white text-center p-10'
        style={{
          backgroundImage: "url('Fondo_Logo.svg')",
        }}
      >
        <h2 className='text-4xl font-bold mb-6'>Bienvenido a</h2>
        <img src='Logo_Ingenial_AI.svg' alt='Ingenial IA' className='mx-auto w-[380px]' />
      </div>
    </div>
  );
};

export default Signin;
