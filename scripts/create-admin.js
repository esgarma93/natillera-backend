/**
 * Script para crear el primer usuario administrador
 * 
 * Uso:
 *   node scripts/create-admin.js <celular> <pin> <partnerId>
 * 
 * Ejemplo:
 *   node scripts/create-admin.js 3001234567 4567 507f1f77bcf86cd799439011
 */

const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3001';

async function createAdminUser(celular, password, partnerId) {
  try {
    console.log('🔐 Creando usuario administrador...');
    console.log(`📱 Celular: ${celular}`);
    console.log(`🔑 PIN: ${password}`);
    console.log(`👤 Partner ID: ${partnerId}`);
    console.log('');

    const response = await axios.post(`${API_URL}/users`, {
      celular,
      password,
      role: 'admin',
      partnerId,
    });

    console.log('✅ Usuario administrador creado exitosamente!');
    console.log('');
    console.log('📋 Información del usuario:');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Celular: ${response.data.celular}`);
    console.log(`   Rol: ${response.data.role}`);
    console.log(`   Socio: ${response.data.partnerName || 'N/A'}`);
    console.log('');
    console.log('🚀 Ahora puedes iniciar sesión con estas credenciales:');
    console.log(`   Celular: ${celular}`);
    console.log(`   PIN: ${password}`);
    console.log('');
    console.log('🌐 Ve a: http://localhost:3000/login');

  } catch (error) {
    console.error('❌ Error al crear usuario administrador:');
    if (error.response) {
      console.error(`   ${error.response.data.message}`);
      console.error(`   Status: ${error.response.status}`);
    } else {
      console.error(`   ${error.message}`);
    }
    console.log('');
    console.log('💡 Posibles soluciones:');
    console.log('   1. Verificar que el servidor esté corriendo (npm run start:dev)');
    console.log('   2. Verificar que el partnerId exista en la base de datos');
    console.log('   3. Verificar que el celular no esté ya registrado');
    process.exit(1);
  }
}

// Validar argumentos
const args = process.argv.slice(2);

if (args.length !== 3) {
  console.error('❌ Uso incorrecto del script');
  console.log('');
  console.log('📖 Uso:');
  console.log('   node scripts/create-admin.js <celular> <pin> <partnerId>');
  console.log('');
  console.log('📝 Ejemplo:');
  console.log('   node scripts/create-admin.js 3001234567 4567 507f1f77bcf86cd799439011');
  console.log('');
  console.log('ℹ️  Parámetros:');
  console.log('   celular   - Número de celular (10-15 dígitos)');
  console.log('   pin       - PIN de 4 dígitos');
  console.log('   partnerId - ID del socio asociado (debe existir)');
  process.exit(1);
}

const [celular, password, partnerId] = args;

// Validar formato de celular
if (!/^\d{10,15}$/.test(celular)) {
  console.error('❌ El celular debe contener entre 10 y 15 dígitos');
  process.exit(1);
}

// Validar formato de PIN
if (!/^\d{4}$/.test(password)) {
  console.error('❌ El PIN debe ser exactamente 4 dígitos');
  process.exit(1);
}

// Ejecutar
createAdminUser(celular, password, partnerId);
