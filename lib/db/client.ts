// Database client configuration for PostgreSQL
import { Pool } from 'pg';

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_HOST',
  'DATABASE_NAME',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0 && process.env.NODE_ENV !== 'test') {
  console.warn(`⚠️  Missing database environment variables: ${missingVars.join(', ')}`);
  console.warn('   Database operations will fall back to localStorage');
}

// Create connection pool
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === 'true' ? {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  } : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection cannot be established
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit in production, just log the error
  if (process.env.NODE_ENV === 'development') {
    console.error('Database connection error - falling back to localStorage');
  }
});

// Test connection on startup (non-blocking)
if (process.env.DATABASE_HOST) {
  pool.query('SELECT NOW()')
    .then(() => {
      console.log('✅ Database connected successfully');
    })
    .catch((err) => {
      console.warn('⚠️  Database connection failed:', err.message);
      console.warn('   Application will use localStorage fallback');
    });
}

export default pool;
