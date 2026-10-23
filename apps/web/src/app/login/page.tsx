import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata = { title: 'Iniciar sesión · PV-IoT' };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
