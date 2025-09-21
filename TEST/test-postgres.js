import { Client } from 'pg';

async function testPostgresConnection() {
    const client = new Client({
        host: 'localhost',
        port: 5432,
        database: 'cipher_db',
        user: 'postgres',
        password: 'Prosinec2012',
        ssl: false
    });

    try {
        console.log('🔌 Connecting to PostgreSQL...');
        await client.connect();
        console.log('✅ Connected successfully!');
        
        console.log('🧪 Testing basic query...');
        const result = await client.query('SELECT version()');
        console.log('📊 PostgreSQL version:', result.rows[0].version);
        
        console.log('🗄️ Testing database access...');
        const dbResult = await client.query('SELECT current_database()');
        console.log('📁 Current database:', dbResult.rows[0].current_database);
        
        console.log('✅ PostgreSQL connection test successful!');
        
    } catch (error) {
        console.error('❌ PostgreSQL connection failed:', error.message);
        process.exit(1);
    } finally {
        await client.end();
        console.log('🔌 Connection closed.');
    }
}

testPostgresConnection();

