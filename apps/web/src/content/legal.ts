// Aviso de privacidad y términos de uso (specs/02 §Datos personales, F10-T5).
// ⚠️ BORRADOR: estructura conforme a la LFPDPPP, pendiente de revisión legal (PREGUNTAS #199). Los
// textos entre corchetes los completa el equipo; no se publican en producción sin esa revisión.

export type LegalBlock = { p: string } | { list: string[] };
export type LegalSection = { heading: string; blocks: LegalBlock[] };
export type LegalDocument = {
  title: string;
  version: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
};

export const LEGAL_DRAFT = true;

export const PRIVACY_NOTICE: LegalDocument = {
  title: 'Aviso de privacidad',
  version: '0.1 (borrador)',
  updated: '2026-10-24',
  intro:
    'PV-IoT es una plataforma de monitoreo de sistemas solares que usan empresas instaladoras. Este aviso explica qué datos personales se tratan en la plataforma, para qué y cómo ejercer sus derechos.',
  sections: [
    {
      heading: '1. Quién es responsable de sus datos',
      blocks: [
        {
          p: 'Cada empresa instaladora es responsable de los datos de sus clientes y de su personal que registra en la plataforma. [Razón social de PV-IoT], con domicilio en [domicilio], presta el servicio de la plataforma y trata esos datos por cuenta de la empresa instaladora (encargado), y es responsable de los datos de las cuentas de acceso.',
        },
      ],
    },
    {
      heading: '2. Qué datos tratamos',
      blocks: [
        {
          list: [
            'De los clientes de la empresa instaladora: nombre, persona de contacto, teléfono, correo, domicilio y ubicación aproximada del sistema solar, tarifa eléctrica y consumo promedio.',
            'Del sistema solar: datos técnicos, producción de energía y estado del inversor.',
            'De los usuarios de la plataforma: nombre, correo, rol, contraseña (guardada solo como hash) y registros de acceso.',
            'Credenciales de los portales de los fabricantes de inversores: se guardan cifradas y nunca se muestran.',
          ],
        },
        { p: 'No tratamos datos personales sensibles.' },
      ],
    },
    {
      heading: '3. Para qué los usamos',
      blocks: [
        {
          list: [
            'Monitorear la producción de los sistemas solares y detectar fallas, suciedad o desconexiones.',
            'Coordinar el mantenimiento entre la empresa instaladora y sus técnicos.',
            'Generar y enviar el reporte mensual de generación a cada cliente.',
            'Dar acceso seguro a la plataforma y llevar un registro de acciones sensibles.',
          ],
        },
        {
          p: 'No usamos los datos para publicidad ni los vendemos. Los datos de una empresa instaladora nunca se muestran a otra.',
        },
      ],
    },
    {
      heading: '4. Con quién se comparten',
      blocks: [
        {
          p: 'Solo con proveedores que prestan el servicio, bajo obligación de confidencialidad:',
        },
        {
          list: [
            'Alojamiento de la plataforma y la base de datos: [proveedor y país].',
            'Envío de correos (alertas, invitaciones y reportes): [proveedor y país].',
            'Almacenamiento de logos y reportes en PDF: [proveedor y país].',
            'Inteligencia artificial para explicar alertas, redactar reportes y responder preguntas sobre la flota: [proveedor y país]. Recibe datos técnicos de los sistemas, nombres de plantas y de clientes; nunca teléfonos, correos, domicilios ni credenciales.',
            'Servicio de clima: recibe solo la ubicación aproximada y la orientación de cada sistema.',
            'Portales de los fabricantes de inversores: reciben las credenciales que captura la empresa instaladora para leer la producción.',
          ],
        },
      ],
    },
    {
      heading: '5. Cuánto tiempo los conservamos',
      blocks: [
        {
          p: 'Las lecturas detalladas de cada inversor se conservan 13 meses; los resúmenes diarios de producción, mientras la empresa instaladora use el servicio. [Plazo de conservación después de terminar el servicio.]',
        },
      ],
    },
    {
      heading: '6. Sus derechos (ARCO) y cómo ejercerlos',
      blocks: [
        {
          p: 'Usted puede acceder a sus datos, rectificarlos, cancelarlos u oponerse a su uso, así como revocar su consentimiento o limitar su uso. Si es cliente de una empresa instaladora, diríjase primero a ella. También puede escribir a [correo de privacidad], indicando su nombre, el derecho que quiere ejercer y un medio para responderle. Responderemos en los plazos que marca la ley.',
        },
      ],
    },
    {
      heading: '7. Cambios a este aviso',
      blocks: [
        {
          p: 'Publicaremos cualquier cambio en esta página, con su fecha de actualización.',
        },
      ],
    },
  ],
};

export const TERMS: LegalDocument = {
  title: 'Términos de uso',
  version: '0.1 (borrador)',
  updated: '2026-10-24',
  intro:
    'Estos términos regulan el uso de la plataforma PV-IoT por parte de las empresas instaladoras y de sus usuarios.',
  sections: [
    {
      heading: '1. El servicio',
      blocks: [
        {
          p: 'PV-IoT permite monitorear sistemas solares, recibir alertas, coordinar tickets de mantenimiento, consultar un asistente de inteligencia artificial y enviar reportes mensuales a los clientes. Las condiciones comerciales (plan, precio y vigencia) se acuerdan por separado con cada empresa instaladora. [Referencia al contrato.]',
        },
      ],
    },
    {
      heading: '2. Cuentas y seguridad',
      blocks: [
        {
          list: [
            'Cada cuenta es personal; no comparta su contraseña.',
            'La empresa instaladora decide quién tiene acceso y con qué rol, y debe desactivar a quien ya no deba entrar.',
            'Avísenos de inmediato si sospecha de un acceso no autorizado.',
          ],
        },
      ],
    },
    {
      heading: '3. Uso permitido',
      blocks: [
        {
          list: [
            'Registrar solo datos de clientes y sistemas con los que la empresa tiene relación y aviso de privacidad propio.',
            'No intentar acceder a datos de otras empresas, ni probar o saturar la plataforma sin autorización.',
            'Capturar únicamente credenciales de inversor que la empresa esté autorizada a usar.',
          ],
        },
      ],
    },
    {
      heading: '4. Estimaciones e inteligencia artificial',
      blocks: [
        {
          p: 'Los ahorros, pérdidas, predicciones de lavado y explicaciones generadas con inteligencia artificial son estimaciones calculadas con los datos disponibles. Sirven de apoyo y no sustituyen la revisión técnica en sitio. Las cifras de ahorro dependen de la tarifa capturada.',
        },
      ],
    },
    {
      heading: '5. Disponibilidad',
      blocks: [
        {
          p: 'Procuramos que la plataforma esté disponible y respaldamos la información, pero los datos dependen también de los portales de los fabricantes y del servicio de clima, que pueden fallar. [Nivel de servicio acordado, si lo hay.]',
        },
      ],
    },
    {
      heading: '6. Datos y terminación',
      blocks: [
        {
          p: 'Los datos que registra la empresa instaladora son suyos. Al terminar el servicio puede solicitar una exportación. [Plazo y forma de exportación y de borrado.]',
        },
      ],
    },
    {
      heading: '7. Cambios y contacto',
      blocks: [
        {
          p: 'Podemos actualizar estos términos y lo avisaremos en la plataforma. Dudas: [correo de contacto]. [Ley aplicable y jurisdicción.]',
        },
      ],
    },
  ],
};
