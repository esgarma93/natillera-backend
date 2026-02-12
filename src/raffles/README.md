# Módulo de Rifas Mensuales

## Descripción General

Este módulo gestiona la rifa mensual de la natillera, donde cada socio paga $7,000 adicionales a su cuota de ahorro. El ganador se determina el último viernes de cada mes según los resultados de la Lotería de Medellín.

## Características

### 1. Entidad MonthlyRaffle
Almacena toda la información de cada rifa mensual:
- Fecha de la rifa (último viernes del mes)
- Fecha del sorteo (sábado siguiente)
- Número ganador de la lotería
- Total recaudado
- Monto del premio (50% de lo recaudado)
- Monto restante en la natillera (50%)
- Información del ganador (si existe)
- Estado: `pending`, `completed`, `no_winner`

### 2. Cálculo Automático
- **Recaudación**: $7,000 × número de pagos verificados ese mes
- **Premio**: 50% del total recaudado
- **Para la natillera**: 50% del total recaudado

### 3. Determinación del Ganador
- Los últimos 2 dígitos del número de la Lotería de Medellín deben coincidir con los últimos 2 dígitos del número de rifa del socio
- Solo pueden ganar socios que hayan pagado ese mes
- Si no hay coincidencia, todo el monto queda en la natillera

### 4. Job Automático
- **Cron**: Todos los sábados a las 00:00 AM
- **Valida**: Si es el sábado siguiente al último viernes del mes
- **Acción**: 
  - Consulta https://loteriademedellin.com.co/resultados/
  - Extrae el número del elemento `.elementor-lottery-jackpot-number`
  - Procesa el sorteo
  - Determina el ganador
  - Registra los resultados

## API Endpoints

### GET /raffles
Obtener todas las rifas (ordenadas por año/mes descendente)
```json
[
  {
    "id": "...",
    "month": 2,
    "monthName": "Febrero",
    "year": 2026,
    "raffleDate": "2026-02-27T00:00:00.000Z",
    "drawDate": "2026-02-28T00:00:00.000Z",
    "lotteryNumber": "1234",
    "winningDigits": "34",
    "totalCollected": 280000,
    "prizeAmount": 140000,
    "remainingAmount": 140000,
    "winnerId": "...",
    "winnerName": "Juan Pérez",
    "winnerRaffleNumber": "34",
    "status": "completed"
  }
]
```

### GET /raffles/year/:year
Obtener rifas de un año específico
```
GET /raffles/year/2026
```

### GET /raffles/stats/:year
Obtener estadísticas de rifas de un año
```json
{
  "totalCollected": 3360000,
  "totalPrizes": 1680000,
  "totalRemaining": 1680000,
  "rafflesWithWinner": 8,
  "rafflesWithoutWinner": 4
}
```

### GET /raffles/:month/:year
Obtener rifa de un mes específico
```
GET /raffles/2/2026
```

### POST /raffles/trigger/:month/:year
Disparar manualmente el proceso de rifa (solo admin)
```
POST /raffles/trigger/2/2026
```
**Nota**: Útil para procesamiento manual o reprocesar un mes

## Integración con Home Dashboard

Para mostrar el monto recogido de rifas en el dashboard:

```javascript
// Frontend API call
const raffleStats = await fetch('/api/raffles/stats/2026');
const stats = await raffleStats.json();

// Mostrar en el dashboard:
// - Total recaudado en rifas: stats.totalCollected
// - Total pagado en premios: stats.totalPrizes  
// - Total en la natillera: stats.totalRemaining
```

## Lógica de Negocio

### Flujo Completo

1. **Durante el mes**: Los socios pagan su cuota + $7,000 de rifa
2. **Último viernes**: Fecha oficial de la rifa
3. **Sábado 00:00**: Job automático se ejecuta
4. **Verificación**: ¿Es el sábado después del último viernes?
5. **Scraping**: Obtiene número de Lotería de Medellín
6. **Cálculo**: Total recaudado = pagos verificados × $7,000
7. **Búsqueda**: Busca socio con últimos 2 dígitos coincidentes
8. **Validación**: ¿El socio pagó ese mes?
9. **Resultado**:
   - **Con ganador**: 50% al ganador, 50% queda en natillera
   - **Sin ganador**: 100% queda en natillera

### Ejemplo de Determinación de Ganador

```
Número de lotería: 8734
Últimos 2 dígitos: 34

Socios activos que pagaron:
- Juan Pérez (#234) ✅ Ganador! (últimos 2 dígitos = 34)
- María López (#145) ❌ (últimos 2 dígitos = 45)
- Pedro García (#534) ❌ (últimos 2 dígitos = 34 pero NO pagó)
```

## Configuración

### Variables de Entorno
No requiere variables adicionales. El valor de $7,000 está hardcodeado en el servicio como constante.

### Dependencias Necesarias
```json
{
  "@nestjs/schedule": "^2.2.3",
  "cheerio": "^1.0.0-rc.12"
}
```

## Consideraciones de Producción

### 1. Manejo de Errores
- Si falla el scraping, registra error en logs
- No procesa la rifa automáticamente
- Admin puede disparar manualmente: `POST /raffles/trigger/:month/:year`

### 2. Zona Horaria
- El cron se ejecuta según la hora del servidor
- Asegurarse que el servidor esté en la zona horaria correcta (Colombia: UTC-5)

### 3. Backup Manual
- Siempre se puede procesar/reprocesar manualmente
- Útil si el job automático falla

### 4. Validaciones
- No se puede procesar una rifa que ya está `completed` o `no_winner`
- Solo se cuentan pagos con status `verified`
- Solo pueden ganar socios activos que hayan pagado

## Próximas Mejoras

1. Notificaciones por WhatsApp al ganador
2. Email automático con detalles del sorteo
3. Histórico de ganadores en el frontend
4. Dashboard con gráficos de rifas
5. Exportar reportes de rifas en PDF/Excel
