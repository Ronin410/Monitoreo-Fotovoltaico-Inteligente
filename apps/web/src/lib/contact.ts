// Contacto comercial de la página pública (/inicio, docs/plan-lanzamiento.md 6.7). Se configura en
// el build con NEXT_PUBLIC_CONTACT_EMAIL y NEXT_PUBLIC_CONTACT_WHATSAPP (número con lada, por
// ejemplo 526671234567). No se guardan datos de interesados en la plataforma: el contacto se hace
// por correo o WhatsApp.

export type ContactLink = { kind: 'email' | 'whatsapp'; label: string; href: string };

const DEMO_MESSAGE =
  'Hola, me interesa conocer PV-IoT para el monitoreo de las plantas de mi empresa.';

/** Enlaces de contacto válidos; un valor mal escrito se ignora en lugar de romper la página. */
export function contactLinks(env: {
  email?: string | undefined;
  whatsapp?: string | undefined;
}): ContactLink[] {
  const links: ContactLink[] = [];
  const email = env.email?.trim();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const subject = encodeURIComponent('Demostración de PV-IoT');
    const body = encodeURIComponent(DEMO_MESSAGE);
    links.push({
      kind: 'email',
      label: email,
      href: `mailto:${email}?subject=${subject}&body=${body}`,
    });
  }
  const phone = env.whatsapp?.replace(/[\s+()-]/g, '');
  if (phone && /^\d{10,15}$/.test(phone)) {
    links.push({
      kind: 'whatsapp',
      label: `WhatsApp ${env.whatsapp?.trim()}`,
      href: `https://wa.me/${phone}?text=${encodeURIComponent(DEMO_MESSAGE)}`,
    });
  }
  return links;
}

// Next.js sustituye estas variables al compilar (deben escribirse completas).
export const CONTACT_LINKS = contactLinks({
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
  whatsapp: process.env.NEXT_PUBLIC_CONTACT_WHATSAPP,
});
