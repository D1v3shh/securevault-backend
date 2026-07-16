/**
 * Vault Transit Engine Setup Script
 * Usage: npx ts-node scripts/setup-transit.ts
 */

async function setupTransit() {
  const VAULT_ADDR = process.env.VAULT_ADDR || 'http://localhost:8200';
  const VAULT_TOKEN = process.env.VAULT_TOKEN || 'dev-root-token';

  const headers = {
    'X-Vault-Token': VAULT_TOKEN,
    'Content-Type': 'application/json',
  };

  console.log(`\n🔐 Setting up Vault Transit engine at ${VAULT_ADDR}\n`);

  try {
    // Enable Transit secrets engine
    console.log('1️⃣  Enabling Transit secrets engine...');
    const mountRes = await fetch(`${VAULT_ADDR}/v1/sys/mounts/transit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'transit' }),
    });
    
    if (!mountRes.ok) {
      const err = await mountRes.json();
      if (err.errors && err.errors[0].includes('path is already in use')) {
        console.log('   ✅ Transit engine already enabled.');
      } else {
        throw new Error(`Failed to mount: ${JSON.stringify(err)}`);
      }
    } else {
      console.log('   ✅ Transit engine enabled.');
    }

    // Create securevault-key
    console.log('2️⃣  Creating encryption key "securevault-key"...');
    const keyRes = await fetch(`${VAULT_ADDR}/v1/transit/keys/securevault-key`, {
      method: 'POST',
      headers,
    });

    if (!keyRes.ok) {
      const err = await keyRes.json();
      console.log(`   ⚠️ Note: Key creation returned status ${keyRes.status} (It might already exist).`);
    } else {
      console.log('   ✅ Encryption key created.');
    }

    console.log('\n🎉 Transit engine setup complete!\n');
  } catch (error: any) {
    console.error(`\n❌ Setup failed: ${error.message}\n`);
    process.exit(1);
  }
}

setupTransit();
