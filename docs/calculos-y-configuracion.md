# Cálculos y configuración de PV-IoT

Este documento explica, en palabras simples, **qué calcula la plataforma, con qué datos y qué se puede ajustar**. Está escrito para quien administra el producto; los detalles técnicos y las pruebas están en `specs/05-motor-de-rendimiento.md` y `specs/06-alertas-inteligentes.md`, que mandan si hay diferencias.

Actualizado al 2026-11-12.

---

## 1. De dónde salen los datos

| Dato                    | Fuente                                                                                                                                     | Cada cuánto                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Producción del inversor | Portal de cada fabricante (Victron hoy; Enphase listo para probar; GoodWe y Growatt en integración)                                        | Cada 15 min con sol; Enphase cada 2 horas (cobra por consulta) |
| Clima por hora          | Open-Meteo: irradiancia **sobre el plano de los paneles** (usa la inclinación y orientación de la planta), temperatura, nubosidad y lluvia | Cada hora                                                      |
| Eventos de la planta    | Lavados, reparaciones (al cerrar tickets) y "lavado por lluvia" (automático)                                                               | Cuando ocurren                                                 |

**Normalización de la producción.** Todo se guarda en **intervalos de 15 minutos**: potencia promedio (kW) y energía del intervalo (kWh).

- Si el inversor da un **contador de energía del día**, la energía del intervalo es la diferencia del contador (con el reinicio a medianoche).
- Si falta un hueco de hasta 1 hora, esa diferencia se reparte entre los intervalos faltantes (marcados como "rellenados").
- Si no hay contador, energía = potencia × 0.25 h.
- De noche no se consulta al fabricante: solo dentro de la "ventana de sol" (amanecer − 30 min a atardecer + 30 min), calculada con la ubicación de la planta.

---

## 2. Cálculo diario (cada noche a las 22:00, hora de la empresa)

### 2.1 Por cada hora del día

```
G        = irradiancia promedio sobre los paneles en la hora (W/m²)
T_celda  = T_ambiente + (NOCT − 20) / 800 × G
F_temp   = 1 + (γ / 100) × (T_celda − 25)        (limitado entre 0.5 y 1.10)
E_stc    = kWp × G / 1000                        energía teórica en condiciones estándar
E_esp    = E_stc × F_temp                        energía esperada, corregida por calor
E_real   = energía medida por el inversor en esa hora
```

- **Por qué hora por hora:** a mediodía en Culiacán la celda pasa de 65 °C y pierde mucho rendimiento; a las 8:00 casi no. Un solo factor diario daría falsas alarmas.
- Una hora está **cubierta** si tiene clima y al menos 3 de sus 4 intervalos de 15 min.

### 2.2 Resultado del día

| Indicador                  | Fórmula                                                           | Qué significa                                                                               |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Energía del día            | Suma de la energía medida                                         | Lo que se reporta al cliente                                                                |
| Rendimiento específico     | Energía ÷ kWp                                                     | kWh por cada kWp instalado; permite comparar plantas de distinto tamaño                     |
| PR                         | Σ E_real ÷ Σ E_stc (horas cubiertas)                              | Rendimiento sin corregir por calor                                                          |
| **PR corregido (PR_temp)** | Σ E_real ÷ Σ E_esp (horas cubiertas)                              | **El indicador principal:** qué tanto entregó de lo que debía según el sol y la temperatura |
| Completitud de datos       | 100 × E_stc de horas cubiertas ÷ E_stc de todas las horas con sol | Ponderada por el sol: perder el mediodía pesa más que perder las 7:00                       |

Ejemplo (planta de 5 kWp, una hora a mediodía): G = 900 W/m², 38 °C → T_celda = 66.1 °C, F_temp = 0.836, E_stc = 4.5 kWh, E_esp = 3.76 kWh. Si produjo 3.2 kWh: PR = 71 % (parece mal), **PR corregido = 85 %** (está bien).

### 2.3 ¿El día sirve para comparar? (día válido)

Un día solo se usa para la línea base, las vecinas y la suciedad si cumple todo:

| Condición                  | Valor por defecto | Si no se cumple     |
| -------------------------- | ----------------- | ------------------- |
| Irradiación del día        | ≥ 2.0 kWh/m²      | "Poca irradiación"  |
| Completitud de datos       | ≥ 80 %            | "Datos incompletos" |
| Hubo lecturas del inversor | —                 | "Sin datos"         |
| Hubo clima                 | —                 | "Sin clima"         |

### 2.4 Línea base: cuánto rinde la planta cuando está limpia y sana

- **Propia:** el percentil 80 del PR corregido de los días válidos de los **últimos 90 días**, sin los días con caída brusca. Necesita al menos **10 días válidos**.
  - Se usa el percentil 80 y no el promedio porque en temporada seca la suciedad baja el rendimiento poco a poco, y un promedio "aprendería" la suciedad como normal.
- **Planta nueva** (menos de 10 días): la mediana de las líneas base de sus vecinas. Si no tiene vecinas, **0.85**.

### 2.5 Desviación

```
desviación % = 100 × (línea base − PR corregido) ÷ línea base
```

Positiva = la planta rinde **por debajo** de lo normal para ella.

### 2.6 Comparación con plantas vecinas

- Vecinas: plantas **de la misma empresa**, con día válido, a **5 km** o menos. Si son menos de **3**, se usan las del mismo código postal.
- Cada planta se compara contra su propia línea base, y luego contra la mediana de sus vecinas:

```
índice de vecinas = (PR_temp ÷ línea base de la planta) ÷ mediana de lo mismo en sus vecinas
```

- ≈ 1.0: se comporta igual que su zona. Menor a 0.88: rinde peor que sus vecinas ese día, probablemente no es el clima.
- Nunca se comparan plantas de otras empresas.

### 2.7 Suciedad y fecha sugerida de lavado

1. Se toma el último **reinicio**: un lavado, una reparación o una lluvia de **2 mm** o más (se registra sola).
2. Con los días válidos desde ese reinicio (mínimo **7**), se traza una recta del rendimiento relativo (PR corregido ÷ línea base, en %) contra los días.
3. El umbral para lavar es **100 − 12 = 88 %**.
4. Días para lavar:
   - Si hoy ya está en 88 % o menos → **0** (lavar ya).
   - Si baja más de 0.05 % por día → `(valor de hoy − 88) ÷ caída diaria`, redondeado hacia arriba. Más de 120 días no se muestra.
   - Si no baja → sin fecha (no hay suciedad).
5. **Confianza:** alta si la recta explica bien los puntos (R² ≥ 0.7) y hay 14 días o más; media si R² ≥ 0.4; baja en otro caso.

Ejemplo: hoy 94 %, cae 0.3 % por día → (94 − 88) ÷ 0.3 = **20 días**.

### 2.8 Estado del día de la planta (en este orden)

1. **Sin clima** → "sin datos".
2. **Sin lecturas con sol** → "fuera de línea".
3. Alerta crítica abierta → **crítico**.
4. Desviación > 12 %, lavado en 7 días o menos, o alerta de advertencia abierta → **advertencia**.
5. Si no → **bien**.

---

## 3. Alertas

Todas se evalúan después del cálculo nocturno, salvo "sin datos", que se revisa cada hora.

### 3.1 Evento de zona (evita falsas alarmas)

Si en un grupo de al menos **3** plantas cercanas el **60 %** o más bajan más de 12 % el mismo día, se marca como evento de zona: fue el clima (polvo, humo, nubes), no una falla. Ese día no cuenta para caída brusca ni para suciedad.

### 3.2 Reglas

| Alerta            | Se abre cuando                                                                                                                                                              | Severidad   | Se cierra sola cuando                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| **Sin datos**     | Más de **4 horas con sol** sin lecturas. Si la causa es la conexión con el fabricante (llaves mal, portal caído), se muestra como "problema de conexión", no como alerta    | Crítica     | Vuelven las lecturas                                             |
| **Caída brusca**  | Desviación ≥ **40 %** y el día válido anterior estaba bien (< 15 %)                                                                                                         | Crítica     | Desviación < 10 % dos días válidos                               |
| **Caída parcial** | Desviación ≥ 20 % dos días válidos seguidos, venía bien (< 10 %) y rinde peor que sus vecinas (índice < 0.8). Detecta, por ejemplo, 1 de 3 cadenas de paneles caída (~33 %) | Advertencia | Igual que la anterior                                            |
| **Suciedad**      | Desviación > **12 %** en **3** días válidos seguidos (dentro de 7 días), sin lluvia ≥ 2 mm, con tendencia a la baja                                                         | Advertencia | Lavado y el siguiente día válido < 5 %, o < 5 % dos días válidos |
| **Lavar pronto**  | Faltan de 1 a 7 días para lavar, con confianza media o alta                                                                                                                 | Informativa | Se abre la de suciedad o hay un lavado                           |

- **Si se lavó y la desviación sigue arriba de 12 %** en los 2 días siguientes, la alerta de suciedad sigue abierta con la nota "el lavado no recuperó": la causa es otra (sombra, degradación, falla).
- **Plantas con batería o con límite de inyección:** no reciben caída brusca, suciedad ni lavar pronto, y no sirven de vecinas, porque el inversor puede producir menos a propósito. "Sin datos" sí aplica.
- **Pérdida estimada por día** (en el detalle de la alerta): con bajo rendimiento, energía esperada × (línea base − PR corregido); sin producción, energía esperada × línea base. Se multiplica por la tarifa (la del cliente o la de la empresa) para dar el monto en pesos.

### 3.3 Prioridad de tickets

| Severidad de la alerta | Prioridad base |
| ---------------------- | -------------- |
| Crítica                | Alta           |
| Advertencia            | Normal         |
| Informativa            | Baja           |

Sube un nivel en plantas de **alto impacto**: comerciales, industriales o de **30 kWp o más**. La bandeja "por prioridad" ordena por severidad, luego tipo de instalación y luego tamaño.

**Tiempos de atención:** espera = inicio − creación; trabajo = resuelto − inicio; total = resuelto − creación. Se muestran promedio y mediana de 7, 30 o 90 días.

---

## 4. Reporte mensual del cliente

| Dato                          | Cálculo                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Energía del mes               | Suma de la energía diaria de sus plantas                                                                          |
| Cambio contra el mes anterior | (este mes − anterior) ÷ anterior                                                                                  |
| **Ahorro estimado**           | Energía × tarifa ($/kWh). Usa la tarifa del cliente o, si no tiene, la de la empresa (**3.50 $/kWh** por defecto) |
| CO₂ evitado                   | Energía × factor de emisión (**0.438 kg/kWh** por defecto; falta confirmar el vigente para México)                |
| Cobertura del consumo         | Energía ÷ consumo mensual promedio del cliente (si se capturó)                                                    |
| PR corregido por planta       | Energía de días válidos ÷ energía esperada de esos días                                                           |
| Disponibilidad                | Horas con sol con al menos una lectura ÷ horas con sol                                                            |
| Días nublados / con lluvia    | Nubosidad promedio ≥ 60 % / lluvia ≥ 1 mm                                                                         |

El ahorro con precio fijo por kWh sirve para casas; para negocios con tarifas de CFE por horario hace falta la etapa 2 (pendiente de spec).

---

## 5. Qué se puede configurar

### 5.1 Por empresa — Configuración (solo el administrador de la empresa)

**Umbrales** (los usa el cálculo y las alertas):

| Ajuste                              | Por defecto | Rango permitido | Para qué sirve                                                                                     |
| ----------------------------------- | ----------- | --------------- | -------------------------------------------------------------------------------------------------- |
| Desviación por suciedad             | 12 %        | 1 – 50          | Cuándo se considera sucia; también define el umbral de lavado (100 − 12) y el estado "advertencia" |
| Días seguidos para suciedad         | 3           | 1 – 14          | Cuántos días válidos seguidos antes de alertar                                                     |
| Caída brusca                        | 40 %        | 5 – 100         | Desviación que abre la alerta crítica                                                              |
| Horas sin datos                     | 4 h         | 1 – 48          | Horas con sol sin lecturas antes de "sin datos"                                                    |
| Lluvia que limpia                   | 2 mm        | 0.1 – 100       | Lluvia que cuenta como lavado natural                                                              |
| Irradiación mínima de un día válido | 2.0 kWh/m²  | 0.1 – 10        | Días muy nublados no se usan para comparar                                                         |
| Completitud mínima de un día válido | 80 %        | 1 – 100         | Días con muchos huecos no se usan para comparar                                                    |
| Radio de vecinas                    | 5 km        | 0.5 – 50        | Qué tan lejos se buscan plantas para comparar                                                      |
| Mínimo de vecinas                   | 3           | 1 – 20          | Cuántas hacen falta para comparar y para evento de zona                                            |
| Evento de zona                      | 60 %        | 1 – 100         | % de plantas de la zona que deben bajar a la vez                                                   |

**Valores técnicos por defecto** (se usan al dar de alta plantas y en los reportes):

| Ajuste                         | Por defecto  | Rango      | Nota                                         |
| ------------------------------ | ------------ | ---------- | -------------------------------------------- |
| NOCT del panel                 | 45 °C        | 30 – 70    | Temperatura nominal de operación de la celda |
| Coeficiente de temperatura (γ) | −0.40 %/°C   | −1 a −0.05 | De la hoja de datos del panel                |
| Inclinación                    | 20°          | 0 – 90     |                                              |
| Orientación (azimut)           | 180° (sur)   | 0 – 360    | 90 = este, 270 = oeste                       |
| Tarifa                         | 3.50 $/kWh   | > 0        | Para el ahorro estimado                      |
| Factor de CO₂                  | 0.438 kg/kWh | 0 – 5      | Falta confirmar el vigente para México       |

**Notificaciones:** correos que reciben las alertas y el resumen diario (hasta 20), y si los reportes mensuales se envían solos al cliente.

**Perfil:** nombre, color de marca, logo y **zona horaria** (define a qué hora corre el cálculo nocturno y el resumen diario).

**Integraciones:** llaves de GoodWe y de Enphase de la empresa (cifradas, nunca se vuelven a mostrar).

Lo guardado es solo lo que la empresa cambió; "Restablecer" vuelve a los valores por defecto.

### 5.2 Por planta

| Dato                                | Para qué sirve                                                    |
| ----------------------------------- | ----------------------------------------------------------------- |
| Capacidad (kWp)                     | Energía teórica, rendimiento específico, alto impacto (≥ 30 kWp)  |
| Inclinación y orientación           | Irradiancia sobre los paneles (clima)                             |
| NOCT y γ                            | Corrección por temperatura                                        |
| Ubicación (lat/lon) y código postal | Clima, ventana de sol, vecinas. Sin ubicación la planta no se lee |
| Tipo de instalación                 | Casa, negocio o industria: prioridad de alertas y tickets         |
| Con batería / límite de inyección   | Evita alertas falsas por producción limitada a propósito          |
| Marca y credenciales del inversor   | Cómo se leen sus datos (cifradas)                                 |
| Estado (activa / pausada)           | Una planta pausada no se lee ni genera alertas                    |

### 5.3 Por cliente

Tarifa propia ($/kWh, si no se usa la de la empresa), consumo y recibo mensual promedio (para la cobertura del consumo), y correo para el reporte mensual.

### 5.4 Por la plataforma (superadministrador)

Estado de cada empresa (activa / suspendida), plan y **presupuesto mensual del asistente de IA** (2,000,000 tokens por defecto).

### 5.5 Fijos en el código (cambiarlos requiere desarrollo)

| Valor                                        | Cuánto                                                              |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Ventana de la línea base / mínimo de días    | 90 días / 10 días                                                   |
| Línea base sin datos ni vecinas              | 0.85                                                                |
| Límites del factor de temperatura            | 0.5 – 1.10                                                          |
| Hora cubierta                                | 3 de 4 intervalos                                                   |
| Puntos mínimos para la tendencia de suciedad | 7                                                                   |
| Caída mínima para predecir lavado / máximo   | 0.05 %/día / 120 días                                               |
| Caída parcial                                | 20 % dos días, índice de vecinas < 0.8                              |
| Recuperación de caída / de suciedad          | < 10 % / < 5 %                                                      |
| "Lavar pronto"                               | 1 a 7 días                                                          |
| Alto impacto                                 | Comercial, industrial o ≥ 30 kWp (pregunta abierta: ¿configurable?) |
| Margen de la ventana de sol                  | 30 min                                                              |
| Frecuencia de lectura                        | 15 min; Enphase 2 h                                                 |
| Conservación de lecturas de 15 min           | 13 meses                                                            |
| Hora del cálculo nocturno / resumen diario   | 22:00 / 07:00 (hora de la empresa)                                  |

---

## 6. Calendario de tareas automáticas

| Tarea                       | Cuándo                                 |
| --------------------------- | -------------------------------------- |
| Lectura de inversores       | Cada 15 min con sol (Enphase cada 2 h) |
| Clima                       | Cada hora                              |
| Alerta "sin datos"          | Cada hora                              |
| Cálculo diario y alertas    | 22:00 de la zona horaria de la empresa |
| Resumen diario por correo   | 07:00                                  |
| Reportes mensuales          | Día 1 a las 08:00 (mes anterior)       |
| Limpieza de lecturas viejas | Día 2 de cada mes, de madrugada        |

---

## 7. Preguntas abiertas que afectan los cálculos

- Factor de CO₂ vigente para México (hoy 0.438 kg/kWh).
- Umbral de alto impacto de 30 kWp: ¿se ajusta o se hace configurable por empresa? (`specs/PREGUNTAS.md` #219).
- Plantas con batería: ¿se quiere un aviso suave de bajo rendimiento? (#217).
- Etapa 2: varios inversores por planta y tarifas de negocio de CFE.
