# Hyper PG SQL

A fast and compact library for SQL queries with performance optimization for Node.js and TypeScript.

## Features

- Smart Caching - Automatic caching of SELECT queries to improve performance
- Query Queue - Optimization of data modification queries through a queue
- Batch Processing - Efficient bulk data insertion
- Data Compression - Reduced memory usage through compression
- Transactions - Convenient API for working with transactions
- Automatic Cache Cleanup - Intelligent memory management
- TypeScript Support - Full TypeScript integration

## Installation

```bash
npm install hyper-pg-sql
```

## Usage

### Connecting to the Database

```typescript
import { HyperSQL } from 'hyper-pg-sql';

const db = await new HyperSQL({
  connectionLimit: 10,
  smartCache: true,
  cacheSize: 500
}).connect({
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'postgres',
  password: 'password'
});
```

### Executing Queries

```typescript
// Simple query
const users = await db.query('SELECT * FROM users WHERE active = $1', [true]);

// Query with caching
const products = await db.query(
  'SELECT * FROM products WHERE category = $1', 
  ['electronics'], 
  { cache: true }
);

// Query with immediate execution (bypassing the queue)
await db.query(
  'UPDATE users SET last_login = NOW() WHERE id = $1', 
  [userId], 
  { immediate: true }
);
```

### Transactions

```typescript
const result = await db.transaction(async (client) => {
  // All queries in this block are executed in a single transaction
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, fromAccountId]);
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, toAccountId]);
  
  // Return the transaction result
  return { success: true };
});
```

### Bulk Data Insertion
Set a timeout for any async operation:

```typescript
const users = [
  ['John', 'Doe', 'john@example.com'],
  ['Jane', 'Smith', 'jane@example.com'],
  ['Bob', 'Johnson', 'bob@example.com']
];

const result = await db.bulkInsert(
  'users',
  ['first_name', 'last_name', 'email'],
  users
);

console.log(`Inserted ${result.rowCount} users`);
```

### Clearing the Cache

```javascript
// Clear the entire cache
db.clearCache();
```

### Closing the Connection

```javascript
await db.close();
```

## Configuration
When creating a HyperSQL instance, you can configure the following parameters:


Parameter	        Description	                                         Default Value
- connectionLimit	Maximum number of connections in the pool	         10
- smartCache	    Enable caching of SELECT queries	                 true
- cacheSize	        Maximum number of cached queries	                 500
- batchSize	        Batch size for bulk insertion and queue processing	 100
- compressionLevel	Compression level for cached data (0-9)	             1
- queryTimeout	    Query timeout in milliseconds	                     30000

## API Reference

### Core Methods

- `connect(dbConfig: PoolConfig): Promise<HyperSQL>` - Connect to the database
- `query(sql: string, params?: any[], options?: {cache?: boolean; immediate?: boolean}): Promise<QueryResult>` -  Execute an SQL query
- `transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>` - Execute a transaction
- `bulkInsert(table: string, columns: string[], values: any[][]): Promise<{ rowCount: number }>` - Bulk data insertion
- `clearCache(): HyperSQL` - Clear the cache
- `close(): Promise<void>` - Close the database connection

### Usage Examples

**Working with User Data**

```typescript
import { HyperSQL } from 'hyper-pg-sql';

async function main() {
  const db = await new HyperSQL().connect({
    host: 'localhost',
    database: 'myapp',
    user: 'postgres',
    password: 'secret'
  });

  try {
    // Get users (will be cached)
    const { rows: users } = await db.query('SELECT * FROM users WHERE active = $1', [true]);
    
    // Process each user
    for (const user of users) {
      // Update statistics (will be added to the queue)
      await db.query(
        'UPDATE user_stats SET login_count = login_count + 1 WHERE user_id = $1',
        [user.id]
      );
    }
    
    // Bulk insert logs
    const logEntries = users.map(user => [user.id, 'USER_LOGIN', new Date()]);
    await db.bulkInsert(
      'activity_logs',
      ['user_id', 'action', 'timestamp'],
      logEntries
    );
    
  } finally {
    await db.close();
  }
}

main().catch(console.error);
```
### Processing Transactions

```typescript
import { HyperSQL } from 'hyper-pg-sql';

async function transferFunds(fromAccount, toAccount, amount) {
  const db = await new HyperSQL().connect({
    /* config */
  });
  
  try {
    const result = await db.transaction(async (client) => {
      // Check balance
      const { rows } = await client.query(
        'SELECT balance FROM accounts WHERE id = $1',
        [fromAccount]
      );
      
      if (rows[0].balance < amount) {
        throw new Error('Insufficient funds');
      }
      
      // Withdraw funds
      await client.query(
        'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
        [amount, fromAccount]
      );
      
      // Deposit funds
      await client.query(
        'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
        [amount, toAccount]
      );
      
      // Record transaction
      await client.query(
        'INSERT INTO transactions (from_account, to_account, amount) VALUES ($1, $2, $3)',
        [fromAccount, toAccount, amount]
      );
      
      return { success: true };
    });
    
    return result;
  } finally {
    await db.close();
  }
}
```

## License

MIT

Made with by Michael Ilyash
