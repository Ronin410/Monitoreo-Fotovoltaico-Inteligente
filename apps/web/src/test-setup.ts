import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin globales de Vitest, Testing Library no limpia el DOM sola entre pruebas.
afterEach(cleanup);
