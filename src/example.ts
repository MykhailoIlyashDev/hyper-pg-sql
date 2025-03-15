import { HyperSQL } from '../src/index';

/**
 * This example demonstrates the main features of HyperSQL Lite
 */
async function main() {
  console.log('Starting HyperSQL Lite example...');

  // Initialize the database connection
  const db = await new HyperSQL({
    connectionLimit: 5,
    smartCache: true,
    cacheSize: 100,
    batchSize: 50,
    compressionLevel: 1
  }).connect({
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    user: 'postgres',
    password: 'postgres'
  });

  try {
    console.log('Connected to database');

    // Create a test table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, [], { immediate: true });

    console.log('Created users table');

    // Bulk insert some test data
    const usersToInsert = [
      ['John', 'Doe', 'john.doe@example.com'],
      ['Jane', 'Smith', 'jane.smith@example.com'],
      ['Bob', 'Johnson', 'bob.johnson@example.com'],
      ['Alice', 'Williams', 'alice.williams@example.com'],
      ['Charlie', 'Brown', 'charlie.brown@example.com']
    ];

    const insertResult = await db.bulkInsert(
      'users',
      ['first_name', 'last_name', 'email'],
      usersToInsert
    );

    console.log(`Inserted ${insertResult.rowCount} users`);

    // Demonstrate caching with repeated queries
    console.log('\nDemonstrating query caching:');
    
    console.time('First query (uncached)');
    const result1 = await db.query('SELECT * FROM users WHERE first_name LIKE $1', ['J%']);
    console.timeEnd('First query (uncached)');
    console.log(`Found ${result1.rowCount} users with names starting with J`);

    console.time('Second query (cached)');
    const result2 = await db.query('SELECT * FROM users WHERE first_name LIKE $1', ['J%']);
    console.timeEnd('Second query (cached)');
    console.log(`Found ${result2.rowCount} users with names starting with J (from cache)`);

    // Demonstrate transaction handling
    console.log('\nDemonstrating transactions:');
    
    await db.transaction(async (client) => {
      // Update a user within a transaction
      await client.query(
        'UPDATE users SET last_name = $1 WHERE email = $2',
        ['Doe-Smith', 'jane.smith@example.com']
      );
      
      // Get the updated user
      const { rows } = await client.query(
        'SELECT * FROM users WHERE email = $1',
        ['jane.smith@example.com']
      );
      
      console.log('Updated user within transaction:', rows[0]);
    });

    // Demonstrate queue processing for updates
    console.log('\nDemonstrating update queue:');
    
    // These updates will be queued and processed in batch
    for (let i = 0; i < 3; i++) {
      await db.query(
        'UPDATE users SET first_name = first_name || $1 WHERE id = $2',
        ['-Updated', i + 1]
      );
      console.log(`Queued update for user ID ${i + 1}`);
    }
    
    // Force immediate execution to see the results
    console.log('Processing queue and checking results...');
    const { rows: updatedUsers } = await db.query(
      'SELECT id, first_name, last_name FROM users ORDER BY id LIMIT 3',
      [],
      { immediate: true }
    );
    
    console.log('Updated users:', updatedUsers);

    // Clear cache demonstration
    console.log('\nDemonstrating cache clearing:');
    db.clearCache();
    console.log('Cache cleared');

    console.time('Query after cache clear (uncached)');
    await db.query('SELECT * FROM users WHERE first_name LIKE $1', ['J%']);
    console.timeEnd('Query after cache clear (uncached)');

  } catch (error) {
    console.error('Error in example:', error);
  } finally {
    // Clean up - drop the test table
    try {
      await db.query('DROP TABLE IF EXISTS users', [], { immediate: true });
      console.log('\nCleaned up test table');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }

    // Close the database connection
    await db.close();
    console.log('Database connection closed');
  }
}

// Run the example
main().catch(error => {
  console.error('Unhandled error in example:', error);
  process.exit(1);
});
