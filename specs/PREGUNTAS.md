# Preguntas abiertas y decisiones provisionales

Dudas encontradas al implementar. Cada una indica la opción conservadora que se eligió mientras el PO decide.

## F0-T2 — Variables de entorno

1. **`LLM_PROVIDER=mock`.** `01` solo lista `anthropic`, pero `11` (F7-T2) y `08` §5 piden un "proveedor simulado" para pruebas. Se agregó el valor `mock`, que **no se permite con `NODE_ENV=production`**. ¿De acuerdo?
2. **`SMTP_*`.** `01` dice solo `SMTP_*`. Se definieron `SMTP_HOST`, `SMTP_PORT` (obligatorias con `EMAIL_PROVIDER=smtp`), `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_SECURE` (opcionales).
3. **`EMAIL_PROVIDER` sin valor por defecto.** `01` lo escribe como `resend|smtp` sin elegir uno; se dejó obligatorio para que nadie despliegue sin configurar el correo.
4. **Variables agregadas que no están en `01`:** `NODE_ENV`, `PORT` (Render lo asigna) y `LOCAL_STORAGE_DIR` (directorio para `STORAGE_PROVIDER=local`, por defecto `./storage`).
5. **`SIMULATOR_ENABLED` por defecto `false`.** `01` indica `true` en staging/demo; fuera de ahí se asume apagado.
