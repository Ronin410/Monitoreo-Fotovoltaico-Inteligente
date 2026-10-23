import { Suspense } from 'react';
import { AssistantView } from '@/components/assistant/assistant-view';

export const metadata = { title: 'Asistente IA · PV-IoT' };

export default function AssistantPage() {
  return (
    <Suspense>
      <AssistantView />
    </Suspense>
  );
}
