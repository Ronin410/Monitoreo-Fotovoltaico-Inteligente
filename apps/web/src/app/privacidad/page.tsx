import { LegalPage } from '@/components/legal-page';
import { PRIVACY_NOTICE } from '@/content/legal';

export const metadata = { title: 'Aviso de privacidad · PV-IoT' };

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY_NOTICE} />;
}
