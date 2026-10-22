import type { EmailMessage } from '@pv/adapters';
import type { UserRole } from '@pv/db';

// Plantillas mínimas de autenticación. Las plantillas con la marca de la empresa llegan en
// F5-T4 (specs/06 §6).

const ROLE_LABELS: Record<Exclude<UserRole, 'superadmin'>, string> = {
  company_admin: 'administrador',
  operator: 'operador',
  technician: 'técnico',
};

export function passwordResetEmail(args: { to: string; name: string; link: string }): EmailMessage {
  return {
    to: args.to,
    subject: 'Restablece tu contraseña de PV-IoT',
    text: [
      `Hola ${args.name}:`,
      '',
      'Recibimos una solicitud para restablecer tu contraseña. Usa este enlace en la próxima hora:',
      args.link,
      '',
      'Si no la solicitaste, ignora este correo; tu contraseña no cambia.',
    ].join('\n'),
  };
}

export function invitationEmail(args: {
  to: string;
  companyName: string;
  role: Exclude<UserRole, 'superadmin'>;
  link: string;
}): EmailMessage {
  return {
    to: args.to,
    subject: `Te invitaron a ${args.companyName} en PV-IoT`,
    text: [
      `Te invitaron a unirte a ${args.companyName} en PV-IoT como ${ROLE_LABELS[args.role]}.`,
      '',
      'Acepta la invitación y define tu contraseña en este enlace (vence en 7 días):',
      args.link,
    ].join('\n'),
  };
}
