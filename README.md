# Cabañas Las Tinajas — Sistema de gestión

MVP interno para los encargados/dueños de Cabañas Las Tinajas, Termas de Río Hondo.

## Incluye
- Calendario semanal de las 10 cabañas alojables (1,2,3,4,6,7,8,9,10,11).
- Cabaña 5 reservada como recepción.
- Reservas con cliente, teléfono, huéspedes, cabaña, entrada, salida, estado, seña y notas.
- Control de disponibilidad con hora: una salida a las 10:00 permite una nueva entrada desde las 14:00 del mismo día.
- Ficha de capacidades y camas de cada cabaña.
- Clientes obtenidos del historial de reservas.
- Registro básico de pagos.
- Bloqueos por mantenimiento/uso interno.
- Configuración de dueño, teléfono, precio y horarios.
- Persistencia en `data/db.json`.

## Ejecutar
Requiere Node.js 18+.

```bash
npm install
npm start
```

Abrir `http://localhost:3000`.

## Datos iniciales
Dueño: Ivan Olmedo  
Precio informado: $35.000 por persona  
Entrada: 14:00  
Salida: 10:00  
Recepción: cabaña 5  
Capacidad total: 52 personas

El archivo `data/db.json` se crea automáticamente al iniciar.
