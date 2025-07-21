// === 🔍 ENVIRONMENT VARIABLE VALIDATION ===

interface EnvValidationResult {
  isValid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Validates required environment variables
 */
export function validateEnvironment(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  
  // Required environment variables
  const required = [
    'API_SECRET',
    'NEXT_PUBLIC_API_SECRET',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
  ];
  
  // Optional but recommended
  const recommended = [
    'NEXT_PUBLIC_RTIRL_PULL_KEY',
    'NEXT_PUBLIC_LOCATIONIQ_KEY',
    'NEXT_PUBLIC_PULSOID_TOKEN',
    'NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN',
  ];
  
  // Check required variables
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }
  
  // Check recommended variables
  for (const key of recommended) {
    if (!process.env[key]) {
      warnings.push(key);
    }
  }
  
  // Validate API secret consistency
  if (process.env.API_SECRET !== process.env.NEXT_PUBLIC_API_SECRET) {
    warnings.push('API_SECRET and NEXT_PUBLIC_API_SECRET should be identical');
  }
  
  // Validate KV URL format
  if (process.env.KV_REST_API_URL && !process.env.KV_REST_API_URL.startsWith('https://')) {
    warnings.push('KV_REST_API_URL should be a valid HTTPS URL');
  }
  
  return {
    isValid: missing.length === 0,
    missing,
    warnings
  };
}

/**
 * Logs environment validation results
 */
export function logEnvironmentValidation(): void {
  const result = validateEnvironment();
  
  if (!result.isValid) {
    console.error('❌ Environment validation failed:');
    console.error('Missing required variables:', result.missing);
  }
  
  if (result.warnings.length > 0) {
    console.warn('⚠️ Environment warnings:');
    console.warn('Missing recommended variables:', result.warnings);
  }
  
  if (result.isValid && result.warnings.length === 0) {
    console.log('✅ Environment validation passed');
  }
} 