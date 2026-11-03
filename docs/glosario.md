# Glosario de PV-IoT

Las palabras que usa la plataforma, en orden alfabético. Los números entre paréntesis son los valores por omisión; cada empresa puede cambiar los umbrales en **Configuración → Alertas**.

## A

- **Adaptador.** El código que sabe leer los datos de una marca de inversor desde la nube del fabricante. Hoy funciona el del **simulador**; los de GoodWe, Growatt y Victron se programan cuando haya documentación oficial de cada marca.
- **Ahorro estimado.** Energía generada × tarifa del cliente (MXN/kWh). Es una estimación: el ahorro real depende del recibo de CFE.
- **Alerta.** Aviso automático de que una planta tiene un problema. Tiene **tipo**, **severidad** y **estado**. Las abre y las cierra la plataforma con reglas; una persona puede marcarla como vista o descartarla.
- **Alertas, estados.**
  - **Abierta:** nadie la ha revisado.
  - **Vista:** alguien la reconoció o ya tiene ticket.
  - **Resuelta:** los datos confirman que se corrigió; casi siempre se resuelve sola.
  - **Descartada:** una persona decidió que no aplica, con un motivo obligatorio.
- **Alertas, tipos.**
  - **Planta sin datos (offline):** el inversor no manda lecturas durante más de 4 horas con sol.
  - **Caída brusca de producción:** de un día para otro rinde mucho menos.
    - Crítica: 40 % o más por debajo de su normal.
    - Advertencia: 20 % o más dos días seguidos.
    - Suele ser una falla del inversor o de un string.
  - **Posible suciedad:** rinde 12 % o más por debajo de su normal durante 3 días válidos seguidos, sin lluvia que lave, con una tendencia que baja poco a poco.
  - **Lavado próximo:** aviso de que la tendencia de suciedad cruzará el umbral en pocos días.
- **Asistente IA.** Chat donde se hacen preguntas sobre la flota ("¿qué plantas lavo esta semana?"). Responde con datos de la plataforma usando herramientas que solo ven la empresa propia. No da teléfonos ni correos.
- **Auditoría.** Registro de quién hizo una acción sensible y cuándo: inicios de sesión, usuarios, credenciales, umbrales, plantas eliminadas, reportes enviados.
- **Azimut.** Ver _Orientación_.

## C

- **Capacidad (kWp).** Potencia pico instalada de la planta: la suma de los paneles en condiciones de laboratorio. Una casa típica tiene entre 3 y 10 kWp.
- **Cliente.** La persona o negocio dueño de una o varias plantas. Recibe el reporte mensual en su **correo para reportes**.
- **CO₂ evitado.** Energía generada × factor de emisión de la red (0.438 kg de CO₂ por kWh, pendiente de confirmar por el PO).
- **Coeficiente γ (gamma, %/°C).** Cuánto pierde el panel por cada grado arriba de 25 °C (−0.4 %/°C). Viene en la hoja técnica del panel.
- **Confianza (baja, media, alta).** Qué tan segura es una predicción o una explicación según la cantidad y la calidad de los datos.
- **Credenciales del inversor.** Usuario y contraseña, o llave, del portal del fabricante. Se guardan cifradas y nunca se muestran.
- **Cobertura de consumo.** Qué parte del consumo mensual del cliente cubrió su sistema solar. Solo aparece si se capturó su consumo promedio.

## D

- **Datos de ejemplo.** Clientes, plantas simuladas e historia que el superadmin puede cargar en una empresa vacía, solo en ambientes de prueba.
- **Desviación (% bajo su normal).** Cuánto rindió la planta por debajo de su **línea base** en un día válido. 0 % es normal; 15 % es que generó 15 % menos de lo que debía.
- **Día válido.** Un día que sirve para juzgar el rendimiento:
  - tuvo sol suficiente: al menos 2.0 kWh/m² de irradiación;
  - hubo datos del inversor al menos el 80 % del tiempo con sol.

  Los días nublados o con huecos no cuentan para las alertas.

- **Disponibilidad.** De las horas con sol, en qué porcentaje el inversor mandó datos.

## E

- **Energía (kWh).** Lo que la planta generó en un tiempo: hoy, en el mes. Es lo que se ahorra en el recibo.
- **Energía esperada.** Lo que la planta **debería** haber generado con el sol y la temperatura reales de ese día. Se calcula con el clima, la orientación, la capacidad y la corrección por temperatura.
- **Empresa.** La instaladora que usa la plataforma. Sus datos están separados de los de las demás.
- **Espera (tickets).** Tiempo desde que se creó el ticket hasta que alguien presionó "Iniciar".
- **Evento de planta.** Algo que le pasó a la planta y afecta la lectura de sus datos: lavado, lavado por lluvia, reparación, cambio de inversor, puesta en marcha o nota.
- **Evento de zona.** Varias plantas cercanas bajan al mismo tiempo (60 % o más de ellas). Es el clima (polvo, humo, nubes) y no una falla, así que no abre alertas.

## F–I

- **Falla de string.** Un _string_ es una cadena de paneles conectados en serie. Si uno falla, la planta pierde de golpe su parte (por ejemplo, 1 de 3 strings ≈ 33 %). Se detecta como **caída brusca**.
- **Inclinación (°).** Ángulo de los paneles respecto al piso. 0° es plano y 90° es vertical; en Sinaloa suelen ir entre 10° y 25°.
- **Inversor.** Equipo que convierte la corriente de los paneles en la de la casa y mide la producción. Manda sus datos a la nube del fabricante por Wi-Fi.
- **Irradiación / irradiancia.** La energía del sol que llega al panel. La irradiancia es instantánea (W/m²); la irradiación es la acumulada en el día (kWh/m²). La plataforma usa la que llega al **plano del panel** (POA), según su inclinación y orientación.

## L–N

- **Lavado por lluvia.** Una lluvia de 2 mm o más limpia los paneles: reinicia la tendencia de suciedad.
- **Línea base.** Lo "normal" de cada planta: el PR que alcanza en sus buenos días de los últimos 90 (el percentil 80 de sus días válidos). Si tiene menos de 10 días válidos (planta nueva), se usa la de sus vecinas y, a falta de ellas, 85 % (línea base provisional).
- **Mediana.** El valor de en medio cuando se ordenan los datos: la mitad queda abajo y la mitad arriba. No la mueven los casos extremos, a diferencia del promedio.
- **NOCT (°C).** Temperatura del panel en condiciones de operación normales (45 °C). Viene en la hoja técnica y sirve para estimar qué tanto se calienta.

## O–P

- **Orientación / azimut (°).** Hacia dónde ven los paneles: 180° es al sur (lo ideal en México), 90° al este y 270° al oeste.
- **Pérdida estimada.** Energía y dinero que se dejan de generar por día mientras el problema siga, con la tarifa del cliente.
- **Planta.** Un sistema solar instalado: paneles e inversor en un domicilio. Un cliente puede tener varias.
- **Potencia (kW).** Lo que la planta entrega en un momento dado. Varía con el sol a lo largo del día.
- **PR (Performance Ratio) corregido.** Energía real entre la energía esperada corregida por temperatura, en días válidos. Mide qué tan bien aprovecha la planta el sol que recibe, sin importar si el día fue soleado o nublado. Entre 80 % y 90 % es normal.
- **Predicción de lavado / próximo lavado.** Con la tendencia de pérdida desde el último lavado o lluvia, la plataforma estima en cuántos días se cruzará el umbral de suciedad (12 %). "Ya" significa que ya se cruzó.
- **Presupuesto de IA (tokens).** Límite mensual de uso de IA por empresa (2,000,000 tokens). Al 80 % avisa al administrador; al 100 % el asistente se pausa y las explicaciones usan plantilla.
- **Puesta en marcha.** Fecha en que la planta empezó a generar. Mientras junte sus primeros 10 días válidos, su línea base es provisional.

## R–S

- **Reporte mensual.** PDF para el cliente con la energía, el ahorro, el CO₂ evitado, una gráfica diaria y un texto explicativo. Se genera el día 1 del mes siguiente.
- **Rendimiento específico (kWh/kWp).** Energía entre capacidad: permite comparar plantas de distinto tamaño. Un buen día en Culiacán da entre 5 y 6 kWh por kWp.
- **Roles.**
  - **Superadmin:** administra la plataforma.
  - **Administrador:** dirige la empresa.
  - **Operador:** opera la flota.
  - **Técnico:** atiende sus tickets.

  Detalle en [`docs/pantallas.md`](pantallas.md#roles).

- **Severidad.**
  - **Crítica:** atender ya.
  - **Advertencia:** atender pronto.
  - **Aviso:** informativo.

  En pantalla van siempre con ícono y texto, no solo color.

- **Simulador.** Inversor de prueba que genera datos realistas con el clima real. Sirve para demostraciones y pruebas; en producción está apagado.
- **Suciedad.** Polvo y tierra sobre los paneles. Hace bajar la producción poco a poco hasta que se lavan o llueve.

## T–V

- **Tarifa CFE / precio por kWh.** La tarifa del cliente (por ejemplo 1F o PDBT) y su precio en pesos por kWh. Sirven para calcular el ahorro y la pérdida estimada.
- **Telemetría.** Las lecturas del inversor, normalizadas a intervalos de 15 minutos. Se guardan 13 meses; los resúmenes diarios se guardan siempre.
- **Ticket.** Una tarea de mantenimiento: lavado, inspección, reparación u otro. Se crea desde una alerta o a mano y se asigna a un técnico.
- **Ticket, estados.**
  - **Pendiente:** sin fecha.
  - **Programado:** con fecha.
  - **En curso:** el técnico presionó "Iniciar".
  - **Resuelto:** terminado.
  - **Cancelado.**
- **Tiempo de trabajo (tickets).** Desde que el técnico presiona "Iniciar" hasta que resuelve el ticket. **Tiempo total:** desde que se creó hasta que se resolvió.
- **Umbral.** El límite que dispara una alerta; por ejemplo, 12 % de desviación para la suciedad.
- **Vecinas / comparación con vecinas.** Plantas de la **misma empresa** a 5 km o menos (o, si no hay suficientes, del mismo código postal). Si todas bajan a la vez es el clima; si solo baja una, es esa planta.
