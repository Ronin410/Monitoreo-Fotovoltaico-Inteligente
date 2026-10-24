import { LegalPage } from '@/components/legal-page';
import { TERMS } from '@/content/legal';

export const metadata = { title: 'Términos de uso · PV-IoT' };

export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}
