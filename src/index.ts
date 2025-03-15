/**
 * HyperSQL Lite - Швидка і компактна бібліотека для SQL-запитів
 */
import { Pool, PoolClient, QueryResult, PoolConfig } from 'pg';
import * as zlib from 'zlib';

interface HyperSQLConfig {
  connectionLimit?: number;
  smartCache?: boolean;
  cacheSize?: number;
  batchSize?: number;
  compressionLevel?: number;
  queryTimeout?: number;
}

export class HyperSQL {
  private config: HyperSQLConfig;
  private pool: Pool | null = null;
  private memoryStore: Map<string, Buffer> = new Map();
  private writeQueue: Array<{sql: string; params: any[]; time: number}> = [];
  private isProcessingQueue: boolean = false;
  private lastAccess: Map<string, number> = new Map();

  constructor(config: HyperSQLConfig = {}) {
    this.config = {
      connectionLimit: 10,
      smartCache: true,
      cacheSize: 500,
      batchSize: 100,
      compressionLevel: 1,
      queryTimeout: 30000,
      ...config
    };
  }

  /**
   * Підключення до бази даних
   */
  public async connect(dbConfig: PoolConfig): Promise<HyperSQL> {
    try {
      this.pool = new Pool({
        max: this.config.connectionLimit,
        idleTimeoutMillis: 30000,
        statement_timeout: this.config.queryTimeout,
        ...dbConfig
      });
      
      // Запускаємо обробник черги та очищення кешу
      this._startQueueProcessor();
      this._setupCacheCleanup();
      
      return this;
    } catch (error) {
      console.error('Error connecting to database:', error);
      throw error;
    }
  }

  /**
   * Виконання SQL-запиту з оптимізацією
   */
  public async query(sql: string, params: any[] = [], options: {cache?: boolean; immediate?: boolean} = {}): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error('Database connection not established. Call connect() first.');
    }

    try {
      const queryType = this._getQueryType(sql);
      
      // Для SELECT-запитів використовуємо кеш
      if (queryType === 'SELECT' && this.config.smartCache && options.cache !== false) {
        const cacheKey = `${sql}:${JSON.stringify(params)}`;
        
        // Перевірка кешу
        if (this.memoryStore.has(cacheKey)) {
          this.lastAccess.set(cacheKey, Date.now());
          return this._decompressResult(this.memoryStore.get(cacheKey)!);
        }
        
        // Виконання запиту
        const result = await this.pool.query(sql, params);
        
        // Збереження в кеш
        this._cacheResult(cacheKey, result);
        
        return result;
      } 
      // Для запитів на зміну даних використовуємо чергу
      else if (['INSERT', 'UPDATE', 'DELETE'].includes(queryType)) {
        // Інвалідуємо кеш
        this._invalidateCache(sql);
        
        // Додаємо запит до черги
        this.writeQueue.push({ sql, params, time: Date.now() });
        
        // Якщо черга досягла розміру пакета або запит потребує негайного виконання
        if (this.writeQueue.length >= this.config.batchSize! || options.immediate) {
          await this._processWriteQueue();
        }
        
        // Для запитів, які потребують негайного результату
        if (options.immediate) {
          return this.pool.query(sql, params);
        }
        
        // Інакше повертаємо порожній результат
        return Promise.resolve({
          rows: [],
          rowCount: 0,
          command: queryType,
          oid: 0,
          fields: []
        } as unknown as QueryResult);
      } 
      // Для інших типів запитів
      else {
        return this.pool.query(sql, params);
      }
    } catch (error) {
      console.error('Error executing query:', error);
      throw error;
    }
  }

  /**
   * Виконання транзакції
   */
  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('Database connection not established. Call connect() first.');
    }

    // Обробляємо чергу записів перед початком транзакції
    await this._processWriteQueue();
    
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Масове вставлення даних
   */
  public async bulkInsert(table: string, columns: string[], values: any[][]): Promise<{ rowCount: number }> {
    if (!this.pool) {
      throw new Error('Database connection not established. Call connect() first.');
    }

    try {
      // Інвалідуємо кеш
      this._invalidateCache(`INSERT INTO ${table}`);
      
      // Розбиваємо на пакети для ефективного вставлення
      const batchSize = this.config.batchSize!;
      let totalInserted = 0;
      
      for (let i = 0; i < values.length; i += batchSize) {
        const batch = values.slice(i, i + batchSize);
        const placeholders: string[] = [];
        const flatParams: any[] = [];
        
        batch.forEach(row => {
          const rowPlaceholders: string[] = [];
          row.forEach(value => {
            rowPlaceholders.push(`$${flatParams.length + 1}`);
            flatParams.push(value);
          });
          placeholders.push(`(${rowPlaceholders.join(', ')})`);
        });
        
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`;
        const result = await this.pool.query(sql, flatParams);
        totalInserted += result.rowCount ?? 0;
      }
      
      return { rowCount: totalInserted };
    } catch (error) {
      console.error('Error in bulkInsert:', error);
      throw error;
    }
  }

  /**
   * Очищення кешу
   */
  public clearCache(): HyperSQL {
    this.memoryStore.clear();
    this.lastAccess.clear();
    return this;
  }

  /**
   * Закриття з'єднання з базою даних
   */
  public async close(): Promise<void> {
    try {
      await this._processWriteQueue();
      if (this.pool) {
        await this.pool.end();
        this.pool = null;
      }
    } catch (error) {
      console.error('Error closing database connection:', error);
      throw error;
    }
  }

  // Приватні методи
  private _getQueryType(sql: string): string {
    const normalizedSql = sql.trim().toUpperCase();
    if (normalizedSql.startsWith('SELECT')) return 'SELECT';
    if (normalizedSql.startsWith('INSERT')) return 'INSERT';
    if (normalizedSql.startsWith('UPDATE')) return 'UPDATE';
    if (normalizedSql.startsWith('DELETE')) return 'DELETE';
    return 'OTHER';
  }

  private _cacheResult(key: string, result: QueryResult): void {
    if (this.memoryStore.size >= this.config.cacheSize!) {
      // Видаляємо найстаріший запис
      const oldestKey = Array.from(this.lastAccess.entries())
        .sort((a, b) => a[1] - b[1])[0][0];
      this.memoryStore.delete(oldestKey);
      this.lastAccess.delete(oldestKey);
    }
    
    const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(result)), {
      level: this.config.compressionLevel
    });
    
    this.memoryStore.set(key, compressed);
    this.lastAccess.set(key, Date.now());
  }

  private _decompressResult(compressed: Buffer): QueryResult {
    try {
      const decompressed = zlib.inflateSync(compressed).toString();
      return JSON.parse(decompressed);
    } catch (error) {
      console.error('Error decompressing cached result:', error);
      throw new Error('Failed to decompress cached result');
    }
  }

  private _invalidateCache(sql: string): void {
    // Простий підхід: видаляємо кеш для запитів, що стосуються таблиці
    const table = this._extractTableName(sql);
    if (table) {
      for (const [key] of this.memoryStore) {
        if (key.includes(table)) {
          this.memoryStore.delete(key);
          this.lastAccess.delete(key);
        }
      }
    }
  }

  private _extractTableName(sql: string): string | null {
    const match = sql.match(/(?:FROM|INTO|UPDATE)\s+([a-zA-Z0-9_]+)/i);
    return match ? match[1] : null;
  }

  private _startQueueProcessor(): void {
    setInterval(() => {
      if (this.writeQueue.length > 0 && !this.isProcessingQueue) {
        this._processWriteQueue().catch(error => {
          console.error('Error in queue processor:', error);
        });
      }
    }, 100);
  }

  private async _processWriteQueue(): Promise<void> {
    if (this.isProcessingQueue || this.writeQueue.length === 0 || !this.pool) return;
    
    this.isProcessingQueue = true;
    
    try {
      const batch = this.writeQueue.splice(0, this.config.batchSize!);
      
      await this.transaction(async (client) => {
        for (const item of batch) {
          await client.query(item.sql, item.params);
        }
      });
    } catch (error) {
      console.error('Error processing write queue:', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private _setupCacheCleanup(): void {
    setInterval(() => {
      if (this.memoryStore.size > this.config.cacheSize!) {
        const oldEntries = Array.from(this.lastAccess.entries())
          .sort((a, b) => a[1] - b[1])
          .slice(0, Math.floor(this.memoryStore.size / 4));
        
        for (const [key] of oldEntries) {
          this.memoryStore.delete(key);
          this.lastAccess.delete(key);
        }
      }
    }, 30000);
  }
}
