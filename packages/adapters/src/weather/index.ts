import type { Env } from '@pv/config';
import { OpenMeteoWeatherProvider } from './open-meteo.js';
import { SyntheticWeatherProvider } from './synthetic.js';
import type { WeatherProvider } from './types.js';

export { OpenMeteoWeatherProvider } from './open-meteo.js';
export { SyntheticWeatherProvider, type SyntheticWeatherOptions } from './synthetic.js';
export {
  hoursBetween,
  type WeatherHour,
  type WeatherProvider,
  type WeatherRequest,
} from './types.js';

/** Según WEATHER_PROVIDER (la configuración ya viene validada). */
export function createWeatherProvider(env: Env): WeatherProvider {
  if (env.WEATHER_PROVIDER === 'synthetic') return new SyntheticWeatherProvider();
  return new OpenMeteoWeatherProvider({ apiKey: env.WEATHER_API_KEY });
}
