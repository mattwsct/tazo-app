// === Conversion factors ===

export const KM_TO_MI = 0.621371;
export const M_TO_FT = 3.28084;
export const CM_TO_IN = 0.393701;
export const KG_TO_LBS = 2.20462;
export const L_TO_GAL = 0.264172;
export const ML_TO_FLOZ = 0.033814;

// === Conversion functions ===

export function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9 / 5) + 32);
}

export function kmhToMph(kmh: number): number {
  return Math.round(kmh * KM_TO_MI);
}

export function metersToFeet(meters: number): number {
  return Math.round(meters * M_TO_FT);
}

export function kmToMiles(km: number): number {
  return km * KM_TO_MI;
}
