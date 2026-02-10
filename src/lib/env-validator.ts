// === 🔍 ENVIRONMENT VARIABLE VALIDATION ===

interface EnvValidationResult {
  isValid: boolean;
  missing: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Validates required environment variables
 */
export function validateEnvironment(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  
  // Required environment variables
  const required = [
    'ADMIN_PASSWORD',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
  ];
  
  // Optional but recommended
  const recommended = [
    'NEXT_PUBLIC_RTIRL_PULL_KEY',
    'NEXT_PUBLIC_LOCATIONIQ_KEY',
    'NEXT_PUBLIC_PULSOID_TOKEN',
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

  
  // Validate KV URL format
  if (process.env.KV_REST_API_URL && !process.env.KV_REST_API_URL.startsWith('https://')) {
    warnings.push('KV_REST_API_URL should be a valid HTTPS URL');
  }
  
  return {
    isValid: missing.length === 0 && errors.length === 0,
    missing,
    warnings,
    errors
  };
}

/**
 * Logs environment validation results
 */
export function logEnvironmentValidation(): void {
  const result = validateEnvironment();
  
  if (!result.isValid) {
    console.error('❌ Environment validation failed:');
    if (result.missing.length > 0) {
      console.error('Missing required variables:', result.missing);
    }
    if (result.errors.length > 0) {
      console.error('Security errors:', result.errors);
    }
  }
  
  if (result.warnings.length > 0) {
    console.warn('⚠️ Environment warnings:');
    console.warn('Missing recommended variables:', result.warnings);
  }
  
  if (result.isValid && result.warnings.length === 0) {
    console.log('✅ Environment validation passed');
  }
} 