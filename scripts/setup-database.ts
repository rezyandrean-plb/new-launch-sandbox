// Script to set up the database schema
// Run with: npx tsx scripts/setup-database.ts

// Load environment variables from .env.local FIRST
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// Now import after env vars are loaded
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

// Create a new pool here instead of importing from client.ts
// This ensures env vars are loaded first
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === 'true' ? {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function setupDatabase() {
  try {
    console.log('🔌 Connecting to database...');
    console.log(`   Host: ${process.env.DATABASE_HOST}`);
    console.log(`   Database: ${process.env.DATABASE_NAME}\n`);
    
    // Test connection first
    try {
      await pool.query('SELECT NOW()');
      console.log('✅ Database connection successful!\n');
    } catch (error: any) {
      console.error('❌ Database connection failed:', error.message);
      console.error('\nPlease check:');
      console.error('  1. Your .env.local file has correct credentials');
      console.error('  2. Your IP is allowed in RDS security group');
      console.error('  3. Database exists and is accessible\n');
      await pool.end();
      process.exit(1);
    }
    
    // Read the schema file
    const schemaPath = join(process.cwd(), 'lib/db/schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    
    // Better SQL parsing - handle functions and multi-line statements
    // Split by semicolon, but keep function bodies intact
    const statements: string[] = [];
    let currentStatement = '';
    let inFunction = false;
    let dollarQuote = '';
    
    for (const line of schema.split('\n')) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('--')) {
        continue;
      }
      
      // Detect dollar-quoted functions (e.g., $$ or $tag$)
      const dollarQuoteMatch = trimmed.match(/\$([^$]*)\$/);
      if (dollarQuoteMatch) {
        if (!inFunction) {
          dollarQuote = dollarQuoteMatch[0];
          inFunction = true;
        } else if (trimmed.includes(dollarQuote)) {
          inFunction = false;
          dollarQuote = '';
        }
      }
      
      currentStatement += line + '\n';
      
      // If we're not in a function and we see a semicolon, it's the end of a statement
      if (!inFunction && trimmed.endsWith(';')) {
        const statement = currentStatement.trim();
        if (statement && statement !== ';') {
          statements.push(statement);
        }
        currentStatement = '';
      }
    }
    
    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }
    
    console.log(`📝 Found ${statements.length} SQL statements to execute...\n`);
    
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement || statement.length < 10) continue;
      
      try {
        await pool.query(statement);
        successCount++;
        const preview = statement.substring(0, 50).replace(/\s+/g, ' ');
        console.log(`✓ [${i + 1}/${statements.length}] ${preview}...`);
      } catch (error: any) {
        // Ignore "already exists" errors (tables, indexes, etc.)
        if (
          error.message.includes('already exists') ||
          error.code === '42P07' || // duplicate_table
          error.code === '42710' || // duplicate_object
          error.code === '42P16'    // duplicate_object
        ) {
          skippedCount++;
          const preview = statement.substring(0, 50).replace(/\s+/g, ' ');
          console.log(`⚠ [${i + 1}/${statements.length}] Already exists: ${preview}...`);
        } else {
          errorCount++;
          console.error(`\n✗ [${i + 1}/${statements.length}] Error:`, error.message);
          console.error(`   Statement preview: ${statement.substring(0, 100)}...\n`);
          // Don't throw - continue with other statements
        }
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Setup Summary:');
    console.log(`   ✅ Successfully executed: ${successCount}`);
    console.log(`   ⚠️  Already existed (skipped): ${skippedCount}`);
    if (errorCount > 0) {
      console.log(`   ❌ Errors: ${errorCount}`);
    }
    console.log('='.repeat(50));
    
    if (errorCount === 0) {
      console.log('\n✅ Database setup completed successfully!');
      console.log('\n🎉 You can now use save/load/duplicate functionality!');
    } else {
      console.log('\n⚠️  Setup completed with some errors. Please review above.');
    }
    
    await pool.end();
  } catch (error: any) {
    console.error('\n❌ Database setup failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    await pool.end();
    process.exit(1);
  }
}

setupDatabase();
